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

function hasDraftTasksForPublish(draft: unknown): boolean {
  if (!draft || typeof draft !== "object" || Array.isArray(draft)) return false;
  const tasks = (draft as { tasks?: unknown }).tasks;
  return Array.isArray(tasks) && tasks.length > 0;
}

/** 用户确认发布且会话有未发布草案 → 注入发布强提示（含未 prepare 时须先 prepare 再 publish）。 */
export function shouldInjectPublishStagingMemoryHint(input: PublishStagingMemoryHintInput): boolean {
  if (!isPublishConfirmUserMessage(input.userMessage)) return false;
  if (isDraftStagedForPublish(input.latestDraft)) return true;
  return hasDraftTasksForPublish(input.latestDraft);
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
 * 用户在确认发布、模型口播已发布，但本轮未真正调用 publish_task（不要求 draft 已 staged）。
 * 用于 authoritative publish 之前的 orchestrator 重试。
 */
export function detectFalsePublishOnConfirm(input: FalsePublishDetectionInput): boolean {
  if (input.hasPublishResult) return false;
  if (!isPublishConfirmUserMessage(input.userMessage)) return false;
  if (input.toolInvocationNames.includes("publish_task")) return false;
  return looksLikeFalsePublishClaim(input.outboundMarkdown);
}

/** 主管确认发布但 publish_task 未执行时的用户可见提示（非兜底，仅追加说明）。 */
export function formatFalsePublishObservedNotice(): string {
  return (
    "\n\n⚠️ **系统提示**：上条消息提到「已发布」，但 `publish_task` 未执行，任务**未落库**。" +
    "如确认发布请再次回复「确认发布」。"
  );
}

/** @deprecated 已由 formatFalsePublishObservedNotice 取代；保留供测试迁移期引用。 */
export function formatAuthoritativePublishBlockedNotice(input: {
  skippedReason?: string;
  prepareResult?: Record<string, unknown>;
  publishResult?: Record<string, unknown>;
}): string {
  const skipped = String(input.skippedReason ?? "").trim();
  if (skipped === "not_publish_confirm") return "";
  if (skipped === "no_publishable_draft") {
    return "**尚未发布**：当前会话没有可发布的结构化草案。请先完成拆解与负责人指派。";
  }
  if (skipped === "cannot_build_prepare_args") {
    return "**尚未发布**：草案缺少标题/背景描述，或部分子任务尚未指定负责人。请补齐后再次回复「确认发布」。";
  }
  const prepOk = String(input.prepareResult?.ok ?? "");
  if (skipped === "prepare_failed" || prepOk === "false") {
    const hint = String(input.prepareResult?.hint ?? input.prepareResult?.reason ?? "").trim();
    return `**尚未发布**：发布预检未通过。${hint ? hint.slice(0, 200) : "请检查负责人与草案字段后重试。"}`;
  }
  const pubOk = String(input.publishResult?.ok ?? "");
  if (pubOk === "false") {
    const reason = String(input.publishResult?.reason ?? input.publishResult?.message ?? "").trim();
    return `**尚未发布**：落库失败。${reason ? reason.slice(0, 200) : "请稍后重试或在工作台查看。"}`;
  }
  if (skipped) {
    return `**尚未发布**：${skipped}。请在工作台核对或联系管理员。`;
  }
  return formatFalsePublishObservedNotice().trim();
}

const FALSE_SCOPE_SWITCH_CLAIM =
  /(已归档|已切(换|到新任务)|已开新任务|已重置(话题|上下文)?|重置完成|已新建任务|已切到|切换完成)/;

export interface FalseScopeSwitchDetectionInput {
  /** 本轮（重试前）用户原话 */
  userMessage: string;
  /** orchestrator 真的调过的工具名列表 */
  toolInvocationNames: ReadonlyArray<string>;
  /** 即将发给用户的 markdown */
  outboundMarkdown: string;
}

/**
 * 模型声称"已归档/已切到新任务/重置完成"，但本轮实际未调用 start_new_task 工具。
 * 调用方应重试并强制要求调用 start_new_task。
 */
export function detectFalseScopeSwitch(input: FalseScopeSwitchDetectionInput): boolean {
  if (input.toolInvocationNames.includes("start_new_task")) return false;
  const text = String(input.outboundMarkdown ?? "").trim();
  if (!text) return false;
  return FALSE_SCOPE_SWITCH_CLAIM.test(text);
}

/**
 * 构造重试时塞给 orchestrator 的 user 消息：保留原话，前置强指令，要求**立刻**调 start_new_task。
 */
const TOPIC_SWITCH_USER_SIGNAL =
  /换个|新任务|不说这个|另外(一个)?问题|先放一放|归档|换个话题|另一项|重新开始|开新(的)?任务/i;

export interface TopicSwitchWithoutArchiveInput {
  userMessage: string;
  preTurnLatestDraft?: unknown;
  toolInvocationNames: ReadonlyArray<string>;
}

/**
 * 用户明显要换题/归档，但本轮未调 start_new_task（且会话里仍有未发布草案）。
 * 与 detectFalseScopeSwitch（模型口播已切换）互补。
 */
export function detectTopicSwitchWithoutArchive(input: TopicSwitchWithoutArchiveInput): boolean {
  if (!input.preTurnLatestDraft) return false;
  if (input.toolInvocationNames.includes("start_new_task")) return false;
  if (isPublishConfirmUserMessage(input.userMessage)) return false;
  const text = String(input.userMessage ?? "").replace(/\s+/g, " ").trim();
  if (!text || text.length < 4) return false;
  return TOPIC_SWITCH_USER_SIGNAL.test(text);
}

export function buildTopicSwitchRetryUserMessage(originalUserMessage: string): string {
  return [
    "[scopeSwitchAction]",
    "用户已表达切换/新任务意图，但上一轮未调用 start_new_task 归档当前草案。",
    "本轮请**仅**先调用一次 start_new_task(scopeLabel=...)，ok=true 后再处理用户新需求；**禁止**在未归档时输出 draft/tasks[] 或引用旧 task_x。",
    "",
    "[原指令]",
    String(originalUserMessage ?? ""),
  ].join("\n");
}

export function buildScopeSwitchRetryUserMessage(originalUserMessage: string): string {
  const safeOriginal = String(originalUserMessage ?? "").replace(/"/g, "'").slice(0, 200);
  return [
    "[scopeSwitchAction]",
    "上一轮你在用户要求切换/归档任务的情况下，没有调用 start_new_task 就声称「已归档/已切换/已重置」，这违反硬性规则。",
    `本轮请**仅**先调用一次 start_new_task(scopeLabel=...)，拿到 ok=true 后再继续讨论新任务；**禁止**仅输出文字而不调用工具。`,
    "",
    "[原指令]",
    String(originalUserMessage ?? ""),
  ].join("\n");
}

const CLARIFY_TONE_IN_DRAFT_MESSAGE =
  /等待补充|请补充以下|请补充|生成正式(?:的)?(?:任务)?草案|以便我生成|还需补充|缺少关键信息|待您补充|请您补充|补充以下信息/i;

export interface DraftClarifyMixInput {
  message: string;
  hasDraft: boolean;
}

/**
 * 模型同轮输出 draft JSON，但 message 仍带 CLARIFY 追问语气（如「以便我生成正式草案」）。
 * 命中 → 调用方应内部重试，要求纯 DRAFT message 四段。
 */
export function detectDraftClarifyMix(input: DraftClarifyMixInput): boolean {
  if (!input.hasDraft) return false;
  const text = String(input.message ?? "").trim();
  if (!text) return false;
  return CLARIFY_TONE_IN_DRAFT_MESSAGE.test(text);
}

export function buildDraftClarifyMixRetryUserMessage(originalUserMessage: string): string {
  return [
    "[draftClarifyMixAction]",
    "上一轮你在输出 JSON draft/tasks[] 的同时，message 仍使用 CLARIFY 语气（等待补充/请补充/以便我生成正式草案等），违反 v5.23.3 纪律。",
    "本轮请重新输出：**仅 DRAFT 模式** message 四段（①已采纳要点 ②拆解逻辑 ③阅读导览 ④下一步：已有 draft 时仅点将或确认发布；待确认项写入 draft.openQuestions，禁止在 message 里追问）。",
    "同轮必须保留或更新顶层 draft JSON；**禁止** CLARIFY 语气混写。",
    "",
    "[原指令]",
    String(originalUserMessage ?? ""),
  ].join("\n");
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
