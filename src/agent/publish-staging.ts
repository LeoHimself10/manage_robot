/**
 * publish-staging
 *
 * 周五 v5.16.1 prompt 在「prepare_publish_task 已暂存 → 用户回复"确认/发布"」时偶发失守：
 * 模型不调 publish_task，直接输出「任务已发布」。本模块提供：
 *
 *   1) 状态判别：草案是否被 prepare_publish_task 暂存
 *   2) 用户意图判别：本轮是否为「发布确认」短语
 *   3) 输出判别：模型自称"已发布"但实际未调工具
 *
 * orchestrator 用 (1)(2) 触发 memory_context 强提示；
 * dingtalk-bot 用 (1)(2)(3) 联合做"假发布"兜底重试。
 */

/** 草案是否处于「prepare_publish_task 已暂存，待 publish_task 落库」状态。 */
export function isDraftStagedForPublish(draft: unknown): boolean {
  if (!draft || typeof draft !== "object" || Array.isArray(draft)) return false;
  return String((draft as { stagedBy?: unknown }).stagedBy ?? "").trim() === "prepare_publish_task";
}

const PUBLISH_NEGATE = /再改|等等|取消|暂缓|别发|不要发布|先别发|不发了|改一下/i;
const ASSIGN_CONFIRM_ONLY = /确认.{0,8}(分配|负责人|名单|人选)/;

/** 用户本轮是否为「同意按当前预览发布」（排除否定 / 仅分配确认）。 */
export function isPublishConfirmUserMessage(userMessage: string): boolean {
  const text = String(userMessage ?? "").replace(/\s+/g, " ").trim();
  if (!text || text.length > 30) return false;
  if (PUBLISH_NEGATE.test(text)) return false;
  if (ASSIGN_CONFIRM_ONLY.test(text)) return false;
  if (/^(确认发布|发布吧|发布|看着可以|没问题|可以了|就这样|好的发布|确定发布|确认)[。！!？?\s]*$/i.test(text)) {
    return true;
  }
  if (/^(好的)?(那就)?发布(吧)?[。！!？?\s]*$/i.test(text)) return true;
  if (/^(确定|ok|OK)[。！!？?\s]*(发布)?[。！!？?\s]*$/i.test(text)) return true;
  return false;
}

const FALSE_PUBLISH_CLAIM =
  /(任务|本任务|该任务)?(已|已成功|已正式)?(发布|派发|下发)(成功|完成|了)?[。！!]?/;

/**
 * 模型输出是否疑似在「自称已发布」。只在调用方已知 `publish_task` 实际未被调用时使用。
 */
export function looksLikeFalsePublishClaim(outboundText: string): boolean {
  const text = String(outboundText ?? "").trim();
  if (!text) return false;
  // 排除明显的"请发布 / 是否发布 / 准备发布"等非完成态表述
  if (/(请|是否|准备|即将|要不要|想要)\s*(确认|正式|立即)?\s*(发布|派发)/.test(text)) return false;
  if (/(尚未|未|还未|还没有?|没有)\s*(完成)?发布/.test(text)) return false;
  return FALSE_PUBLISH_CLAIM.test(text);
}

export interface PublishStagingMemoryHintInput {
  userMessage: string;
  latestDraft?: unknown;
}

/** 草案已 staged，且用户本轮在确认发布 → 注入「只准 publish」强提示。 */
export function shouldInjectPublishStagingMemoryHint(input: PublishStagingMemoryHintInput): boolean {
  return isDraftStagedForPublish(input.latestDraft) && isPublishConfirmUserMessage(input.userMessage);
}

export interface FalsePublishDetectionInput {
  /** 本轮（重试前）用户原话 */
  userMessage: string;
  /** orchestrator 调用「前」会话里的 latestDraft（不要用调用后的） */
  preTurnLatestDraft?: unknown;
  /** orchestrator 真的调过的工具名列表 */
  toolInvocationNames: ReadonlyArray<string>;
  /** orchestrator 是否报告 publishResult */
  hasPublishResult: boolean;
  /** 即将发给用户的 markdown */
  outboundMarkdown: string;
}

/**
 * 4 条件联合：用户在确认发布 + 会话里已 staged + 工具未真的调用 publish_task + 模型却自称"已发布"。
 * 命中 → 调用方应做"假发布兜底"（重试 / 改写文案 / 落审计）。
 */
export function detectFalsePublish(input: FalsePublishDetectionInput): boolean {
  if (input.hasPublishResult) return false;
  if (!isPublishConfirmUserMessage(input.userMessage)) return false;
  if (!isDraftStagedForPublish(input.preTurnLatestDraft)) return false;
  if (input.toolInvocationNames.includes("publish_task")) return false;
  return looksLikeFalsePublishClaim(input.outboundMarkdown);
}

/**
 * 构造重试时塞给 orchestrator 的 user 消息：保留原话，前置强指令，要求**立刻**调 publish_task。
 * 调用方仍应把**原 userMessage**写入 conversationHistory，避免污染。
 */
export function buildPublishRetryUserMessage(originalUserMessage: string, planId: string): string {
  const safeOriginal = String(originalUserMessage ?? "").replace(/"/g, "'").slice(0, 200);
  const safePlanId = String(planId ?? "").trim();
  return [
    "[publishStagingAction]",
    "上一轮你在主管已确认发布的情况下，没有调用 publish_task 就声称「任务已发布」，这违反硬性规则。",
    `本轮请**仅**调用一次 publish_task(planId="${safePlanId}", confirmationContext="${safeOriginal}")；`,
    "调用成功后再用一句话简短回复主管已发布的结果；**禁止**仅输出文字而不调用工具。",
    "",
    "[原指令]",
    String(originalUserMessage ?? ""),
  ].join("\n");
}
