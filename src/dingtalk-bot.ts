import "dotenv/config";

import http from "node:http";

import {
  DWClient,
  EventAck,
  TOPIC_ROBOT,
  type DWClientDownStream,
} from "dingtalk-stream";

import { loadQwenPlannerConfigFromEnv } from "./agent/demo/qwen-planner";
import {
  deriveLegacyChatSessionKey,
  deriveStableChatSessionKey,
  MemoryChatSessionStore,
  readRateLimitWindowMs,
} from "./infra/session-store";
import { resolveEmployeeProfileDir, resolveAssignmentDraftDir, resolveAssignmentEventsPath, resolveAssignmentWebPort } from "./infra/assignment-env";
import { createEmployeeProfileRepo } from "./integrations/repos/employee-profile-repo";
import { createAssignmentDraftRepo } from "./integrations/repos/assignment-draft-repo";
import { createAssignmentEventRepo } from "./integrations/repos/assignment-event-repo";
import { handleAssignmentHttp } from "./web/assignment-workbench";
import { renderWorkbenchRootLandingHtml } from "./web/workbench-landing";
import { runOrchestrator } from "./agent/orchestrator";
import {
  buildScopeSwitchRetryUserMessage,
  buildTopicSwitchRetryUserMessage,
  buildDraftClarifyMixRetryUserMessage,
  detectDraftClarifyMix,
  detectFalsePublish,
  detectFalsePublishOnConfirm,
  detectFalseScopeSwitch,
  detectTopicSwitchWithoutArchive,
  formatFalsePublishObservedNotice,
} from "./agent/publish-staging";
import { publishResultSucceeded } from "./agent/publish-helpers";
import { buildToolRegistry } from "./agent/tools/registry";
import {
  isDingtalkRoleRoutingEnabled,
  resolveDingtalkAgentRouting,
} from "./agent/role-routing";
import { processAssignmentForTurn } from "./agent/assignment/process-assignment-turn";
import {
  buildAssignRetryUserMessage,
  buildTaskIndexMap,
  detectFalseAssign,
  formatFalseAssignObservedNotice,
} from "./agent/assignment/false-assign";
import { hasAssigneeIntentInUserMessage } from "./agent/orchestrator-turn-hints";
import {
  hasTaskTableInMessage,
  renderDraftSupplementSection,
  appendPublishSummaryMarkdown,
  renderDingtalkTaskMarkdown,
} from "./view/dingtalk-task-markdown";
import { resolveDraftForOutbound } from "./view/draft-outbound";
import { parseRosterFile } from "./agent/assignment/roster-parser";
import { DingTalkFileDownloadError, fetchDingTalkFile } from "./integrations/dingtalk/dingtalk-file-download";
import { savePlanSnapshot } from "./infra/plan-store";
import { savePlanEmbedding, generateQueryEmbedding } from "./infra/plan-index";
import {
  createPlanSessionStore,
  hashChatKey,
  markPublishedAndRotatePlanSession,
  readDingtalkPlanIdRotateEnabled,
  type PlanSession,
} from "./infra/plan-session-store";
import { readSearchSimilarPlansEnabled } from "./agent/tools/search-similar-plans";
import { logStructured } from "./infra/logger";
import { createDingTalkContactSyncService } from "./infra/dingtalk-contact-sync";
import { createReminderScheduler } from "./agent/reminders/reminder-scheduler";
import { createProgressDigestScheduler } from "./agent/progress-digest/progress-digest-scheduler";
import { loadProgressDigestPolicy } from "./agent/progress-digest/progress-digest-policy";
import {
  appendMemoryEvents,
  loadMemoryContextForPlan,
} from "./infra/workbench-memory-store";
import { createRecentPublishStore } from "./agent/tools/publish-task";
import { KNOWN_TOOL_NAMES } from "./agent/tools/registry";
import type { KnownFactsStore } from "./agent/tools/update-known-facts";

/** 钉钉 markdown 单条上限约 2 万字符，预留余量避免被拒收 */
const MAX_MARKDOWN_CHARS = 18_000;
const DEFAULT_DINGTALK_MAX_TOKENS = 8000;
const DEFAULT_DINGTALK_ORCH_ITERATIONS = 6;
const DEFAULT_DINGTALK_TIMEOUT_MS = 120000;
const TOOL_NAME_LEAK_FALLBACK = "（系统检测到模型输出异常，已忽略；请重新描述您的需求。）";
const KNOWN_TOOL_NAME_SET = new Set<string>(KNOWN_TOOL_NAMES);

export function sanitizeToolNameLeak(markdown: string): { markdown: string; leaked: boolean; toolName?: string } {
  const trimmed = markdown.trim();
  if (trimmed.length > 0 && trimmed.length <= 32 && KNOWN_TOOL_NAME_SET.has(trimmed)) {
    return { markdown: TOOL_NAME_LEAK_FALLBACK, leaked: true, toolName: trimmed };
  }
  return { markdown, leaked: false };
}

function truncateMarkdown(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const suffix = "\n\n_(内容过长，已截断展示；完整草案见结构化任务表。)_";
  const budget = Math.max(0, maxChars - suffix.length);
  return text.slice(0, budget) + suffix;
}

// hasTaskTableInMessage, renderDraftSupplementSection, appendPublishSummaryMarkdown
// are now in src/view/dingtalk-task-markdown.ts and imported above.

function isExplicitSearchRequest(input: string): boolean {
  const text = input.trim().toLowerCase();
  if (!text) return false;
  return /联网|搜索|查最新|外部资料|行业资料|外部案例|web search|search web|latest/i.test(text);
}

function readEnvBool(name: string, fallback: boolean): boolean {
  const v = process.env[name]?.trim().toLowerCase();
  if (!v) return fallback;
  if (v === "1" || v === "true" || v === "yes") return true;
  if (v === "0" || v === "false" || v === "no") return false;
  return fallback;
}

function readEnvInt(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) return fallback;
  return Math.max(1, Math.trunc(value));
}

function maskUserId(userId: string): string {
  const normalized = userId.trim();
  if (!normalized) return "";
  if (normalized.length <= 6) return `${normalized.slice(0, 1)}***`;
  return `${normalized.slice(0, 2)}***${normalized.slice(-2)}`;
}

export function shouldUseAnonymousSession(senderStaffId: string): boolean {
  return !String(senderStaffId ?? "").trim();
}

export function buildDingtalkOrchestratorRoutingParams(input: {
  senderStaffId: string;
  employeeRepo: ReturnType<typeof createEmployeeProfileRepo>;
}): {
  roleRoutingEnabled: boolean;
  selectedProfile: "planner" | "manager" | "employee";
  resolvedRole: "admin" | "manager" | "employee" | "unknown";
  reason:
    | "routing_disabled"
    | "missing_sender"
    | "manager_role"
    | "employee_directory_match"
    | "employee_directory_miss";
  toolProfile: "planner" | "manager" | "employee" | "admin" | "full";
  promptProfile: "planner" | "manager" | "employee";
  trustedActorUserId?: string;
} {
  const roleRoutingEnabled = isDingtalkRoleRoutingEnabled();
  const route = resolveDingtalkAgentRouting({
    senderStaffId: input.senderStaffId,
    employeeRepo: input.employeeRepo,
    roleRoutingEnabled,
  });
  return {
    roleRoutingEnabled,
    selectedProfile: route.promptProfile,
    resolvedRole: route.resolvedRole,
    reason: route.reason,
    toolProfile: route.toolProfile,
    promptProfile: route.promptProfile,
    trustedActorUserId: route.trustedActorUserId,
  };
}

async function sendMarkdownReply(params: {
  client: DWClient;
  sessionWebhook: string;
  messageId: string;
  senderStaffId: string;
  title: string;
  markdownText: string;
}): Promise<unknown> {
  const accessToken = await params.client.getAccessToken();
  const body = {
    msgtype: "markdown" as const,
    markdown: {
      title: params.title,
      text: params.markdownText,
    },
    at: {
      atUserIds: [params.senderStaffId],
      isAtAll: false,
    },
  };

  const res = await fetch(params.sessionWebhook, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-acs-dingtalk-access-token": String(accessToken),
    },
    body: JSON.stringify(body),
  });

  const data: unknown = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`sessionWebhook HTTP ${res.status}: ${JSON.stringify(data)}`);
  }
  if (data && typeof data === "object" && "errcode" in data) {
    const code = (data as { errcode?: number }).errcode;
    if (code !== undefined && code !== 0) {
      throw new Error(`sessionWebhook errcode ${code}: ${JSON.stringify(data)}`);
    }
  }
  return data;
}

/** Stream 侧 ACK：机器人回调协议建议 data.response 可为 null；须尽早调用以免 60s 内重推、并与 sessionWebhook 时效竞态。 */
function ackStreamRobot(client: DWClient, messageId: string): void {
  client.socketCallBackResponse(messageId, null);
}

function startCombinedServer(healthPort: number): void {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

    // Load balancers / Docker health probes — keep plain text only on this path.
    if (url.pathname === "/health" && (req.method === "GET" || req.method === "HEAD")) {
      res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
      if (req.method === "HEAD") {
        res.end();
      } else {
        res.end("ok");
      }
      return;
    }

    // DingTalk micro-app home URL is often configured as https://host/ — show HTML, not "ok".
    if ((req.method === "GET" || req.method === "HEAD") && url.pathname === "/") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      if (req.method === "HEAD") {
        res.end();
      } else {
        res.end(renderWorkbenchRootLandingHtml());
      }
      return;
    }

    if (handleAssignmentHttp(req, res)) return;
    res.writeHead(404);
    res.end();
  });
  server.listen(healthPort, () => {
    console.info(`[health] listening on :${healthPort} (/health, / → workbench landing)`);
  });
}

async function main(): Promise<void> {
  const clientId = process.env.DINGTALK_CLIENT_ID?.trim();
  const clientSecret = process.env.DINGTALK_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    console.error(
      "缺少 DINGTALK_CLIENT_ID / DINGTALK_CLIENT_SECRET。请在钉钉开放平台创建企业内部应用并开通 Stream 机器人后配置环境变量。"
    );
    process.exitCode = 1;
    return;
  }

  const baseQwenConfig = loadQwenPlannerConfigFromEnv();
  if (!baseQwenConfig) {
    console.error(
      "未检测到 QWEN_API_KEY。请在环境变量或 .env 中配置（与 DashScope 一致），切勿提交密钥。"
    );
    process.exitCode = 1;
    return;
  }
  const dingtalkQwenConfig = {
    ...baseQwenConfig,
    // 钉钉链路优先首条时延：默认关闭 thinking，可用 DINGTALK_QWEN_THINKING=1 覆盖。
    thinking: readEnvBool("DINGTALK_QWEN_THINKING", false),
    timeoutMs: readEnvInt("DINGTALK_QWEN_TIMEOUT_MS", DEFAULT_DINGTALK_TIMEOUT_MS),
    maxTokens: Math.min(
      baseQwenConfig.maxTokens,
      readEnvInt("DINGTALK_QWEN_MAX_TOKENS", DEFAULT_DINGTALK_MAX_TOKENS),
    ),
    // 钉钉链路启用 SSE 流式：避免长 prompt/慢生成下 keep-alive 被中间网关 idle-断开，
    // 让 fetch 在 chunk 流入期间保持活跃，显著降低"单次 LLM 调用挂死 120s"的概率。
    // 可通过 DINGTALK_QWEN_STREAM=0 关掉作为应急回退。
    stream: readEnvBool("DINGTALK_QWEN_STREAM", true),
  };
  const dingtalkOrchestratorMaxIterations = readEnvInt(
    "DINGTALK_ORCHESTRATOR_MAX_ITERATIONS",
    DEFAULT_DINGTALK_ORCH_ITERATIONS,
  );
  const appendStructuredTaskTable = readEnvBool(
    "DINGTALK_APPEND_STRUCTURED_TABLE",
    true,
  );

  const debug = process.env.DINGTALK_STREAM_DEBUG === "1" || process.env.DINGTALK_STREAM_DEBUG === "true";

  const ports = new Set<number>();
  const healthPort = Number(process.env.HEALTH_CHECK_PORT ?? "");
  if (Number.isFinite(healthPort) && healthPort > 0) {
    ports.add(Math.trunc(healthPort));
  }
  if (
    process.env.ASSIGNMENT_WEB_PORT?.trim() ||
    process.env.ASSIGNMENT_WEB_PUBLIC_BASE_URL?.trim() ||
    process.env.ASSIGNMENT_PHASE_ENABLED === "1"
  ) {
    ports.add(resolveAssignmentWebPort());
  }
  for (const port of ports) {
    startCombinedServer(port);
  }

  const client = new DWClient({
    clientId,
    clientSecret,
    debug,
  });

  const chatSessionMemory = new MemoryChatSessionStore<Record<string, unknown>>();
  const publishRecentStore = createRecentPublishStore();
  const planSessionStore = createPlanSessionStore();
  const employeeRepo = createEmployeeProfileRepo(resolveEmployeeProfileDir());
  const assignmentDraftRepo = createAssignmentDraftRepo(resolveAssignmentDraftDir());
  const assignmentEventRepo = createAssignmentEventRepo(resolveAssignmentEventsPath());
  const contactSyncService = createDingTalkContactSyncService();
  if (process.env.DINGTALK_CONTACT_SYNC_ENABLED === "1") {
    void contactSyncService.runFullSync().catch((err) => {
      logStructured({
        event: "dingtalk_contact_initial_sync_failed",
        reason: err instanceof Error ? err.message : String(err),
      });
    });
    contactSyncService.startIntervalLoop();
  }
  const reminderScheduler = createReminderScheduler();
  reminderScheduler.startIntervalLoop();
  const progressDigestPolicy = loadProgressDigestPolicy();
  const progressDigestScheduler = createProgressDigestScheduler();
  progressDigestScheduler.startIntervalLoop();
  logStructured({
    event: "progress_digest_scheduler_started",
    enabled: progressDigestPolicy.enabled,
    scanIntervalMs: progressDigestPolicy.scanIntervalMs,
    timezone: progressDigestPolicy.timezone,
    digestHour: progressDigestPolicy.digestHour,
    digestMinute: progressDigestPolicy.digestMinute,
  });

  client.registerCallbackListener(TOPIC_ROBOT, (res: DWClientDownStream) => {
    void (async () => {
      const messageId = res.headers.messageId;
      let dingtalkResponse: unknown = { errcode: 0, errmsg: "ok" };
      let streamAckSent = false;

      try {
        const payload = JSON.parse(res.data) as Record<string, unknown>;

        // 提取文本内容：支持 text / paragraph / richText / mixed 等格式
        const raw = payload as Record<string, unknown>;
        const textObj = raw.text as Record<string, unknown> | undefined;
        let content = "";
        if (typeof textObj?.content === "string" && textObj.content.trim()) {
          content = textObj.content.trim();
        } else if (typeof raw.content === "string" && raw.content.trim()) {
          content = raw.content.trim();
        } else if (Array.isArray((raw as any)?.richText)) {
          // DingTalk richText message — extract text from array of segments
          content = (raw as any).richText.map((s: any) => s.text ?? "").join("").trim();
        } else if (typeof raw === "object") {
          // Fallback: try JSON stringify and strip to detect if it's [object Object]
          const fallback = JSON.stringify(raw);
          if (!fallback.includes("[object Object]")) {
            content = String(textObj?.content ?? "").replace(/^\[object Object\]$/, "").trim();
          }
        }

        const background = content;
        const senderStaffId = String(payload.senderStaffId ?? "");
        const isAnonymousSender = shouldUseAnonymousSession(senderStaffId);
        const anonymousChatKey = `anon:${messageId || Date.now()}:${Math.random().toString(36).slice(2, 10)}`;
        const sessionWebhook = String(payload.sessionWebhook ?? "");
        const conversationId = String(payload.conversationId ?? "");
        const conversationType = String(payload.conversationType ?? "");
        const stableKey = deriveStableChatSessionKey({
          conversationId,
          conversationType,
          sessionWebhook,
          senderStaffId,
        });
        const chatKey = isAnonymousSender ? anonymousChatKey : stableKey.chatKey;
        const legacyChatKey = deriveLegacyChatSessionKey({
          sessionWebhook,
          senderStaffId,
        });
        logStructured({
          event: "memory_key_resolved",
          messageId,
          source: isAnonymousSender ? "anonymous" : stableKey.source,
          hasConversationId: conversationId.length > 0,
        });
        if (isAnonymousSender) {
          logStructured({
            event: "dingtalk_anonymous_sender_fallback",
            messageId,
            conversationId,
          });
        }

        if (!chatSessionMemory.checkRateLimitThenTouch(chatKey, readRateLimitWindowMs())) {
          ackStreamRobot(client, messageId);
          streamAckSent = true;
          dingtalkResponse = await sendMarkdownReply({
            client, sessionWebhook, messageId, senderStaffId,
            title: "请稍后再试",
            markdownText: "**请求过于频繁。** 同一会话在短时间内仅处理一条任务规划，请稍后再发。",
          });
          return;
        }

        // 尽早 ACK：避免 Stream 60s 内重推；并让后续 sessionWebhook 尽量仍在有效期内（长模型调用常见 >60s）。
        ackStreamRobot(client, messageId);
        streamAckSent = true;

        const webhookDeadline =
          typeof payload.sessionWebhookExpiredTime === "number"
            ? payload.sessionWebhookExpiredTime
            : undefined;
        if (webhookDeadline !== undefined && Date.now() > webhookDeadline) {
          logStructured({
            event: "dingtalk_session_webhook_already_expired",
            messageId,
            webhookDeadline,
          });
        }

        const handlerStartedAt = Date.now();
        let session: PlanSession | undefined;
        if (!isAnonymousSender) {
          session = planSessionStore.loadByChatKey(chatKey);
          if (!session && chatKey !== legacyChatKey) {
            const legacy = planSessionStore.loadByChatKey(legacyChatKey);
            if (legacy) {
              session = {
                ...legacy,
                chatKeyHash: hashChatKey(chatKey),
              };
              planSessionStore.save(session);
              planSessionStore.deleteByChatKey(legacyChatKey);
              logStructured({
                event: "memory_session_migrated",
                messageId,
                planId: session.planId,
              });
            }
          }
          if (!session) {
            session = planSessionStore.loadOrCreate(chatKey);
          }
        } else {
          const now = new Date().toISOString();
          session = {
            chatKeyHash: hashChatKey(chatKey),
            planId: `anon:${messageId || Date.now()}`,
            createdAt: now,
            updatedAt: now,
            knownFacts: [],
            conversationHistory: [],
          };
        }
        logStructured({
          event: "memory_session_loaded",
          messageId,
          planId: session.planId,
          hit: session.conversationHistory.length > 0,
        });
        const routing = buildDingtalkOrchestratorRoutingParams({
          senderStaffId,
          employeeRepo,
        });

        // === DingTalk 文件消息：仅主管/管理员的 file 消息走花名册流程 ===
        const msgtypeRaw = String((payload as { msgtype?: unknown }).msgtype ?? "").trim();
        if (msgtypeRaw === "file" && !isAnonymousSender) {
          // 开放平台约定：conversationType=2 为群聊。群聊 @ 机器人时官方不支持收文件，换链接口也常直接 400。
          const convType = String(conversationType ?? "").trim();
          if (convType === "2") {
            dingtalkResponse = await sendMarkdownReply({
              client, sessionWebhook, messageId, senderStaffId,
              title: "当前会话被判定为群聊，无法收文件",
              markdownText:
                "钉钉规定：**在群聊里 @ 机器人时，不支持接收文件**（语音、视频同理）。\n\n"
                + "说明：系统从回调里读到 `conversationType=2`（群聊）。若你认为自己是在**与机器人的单聊**，"
                + "可能是客户端会话类型与回调不一致，请把该情况反馈给运维（需对照 Stream 原始回调）。\n\n"
                + "可选操作：\n"
                + "1. **打开与机器人的单聊**（工作台里找到该应用机器人 → 发消息），再发送名单文件；\n"
                + "2. 使用 **工作台上传**：`/workbench/manager/chat` →「上传花名册」。",
            });
            return;
          }
          const fileContent = (payload as { content?: Record<string, unknown> }).content ?? {};
          const downloadCode = String(fileContent.downloadCode ?? "").trim();
          const filename = String(fileContent.fileName ?? fileContent.filename ?? "upload.bin").trim();
          if (!downloadCode) {
            dingtalkResponse = await sendMarkdownReply({
              client, sessionWebhook, messageId, senderStaffId,
              title: "文件接收失败",
              markdownText: "**未取到 downloadCode**，无法下载该文件。请重试或改用工作台上传。",
            });
            return;
          }
          if (routing.resolvedRole !== "manager" && routing.resolvedRole !== "admin") {
            dingtalkResponse = await sendMarkdownReply({
              client, sessionWebhook, messageId, senderStaffId,
              title: "未启用",
              markdownText: "上传花名册仅对**主管 / 管理员**开放。如需调整任务进度请直接发送文字。",
            });
            return;
          }
          // 下载接口要求的是开放平台「机器人 robotCode」（多为 ding 开头），不是 OAuth Client ID。
          const robotCode = resolveDingTalkRobotCodeForFileDownload(payload);
          if (!robotCode) {
            logStructured({
              event: "dingtalk_roster_robot_code_missing",
              messageId,
              planId: session.planId,
            });
            dingtalkResponse = await sendMarkdownReply({
              client, sessionWebhook, messageId, senderStaffId,
              title: "无法下载文件",
              markdownText:
                "**未配置机器人 robotCode**，无法向钉钉换取下载链接。\n\n"
                + "请在服务器环境变量配置 **`DINGTALK_ROBOT_CODE`**：钉钉开放平台 → 本应用 → **机器人** → 名词表里的 **robotCode**（示例为 `ding…` 形态，**不要**把 OAuth 的 Client ID 当成 robotCode）。\n\n"
                + "官方说明：**人与机器人的会话**里机器人可以收文件；换链接口仍要求 robotCode 与当前 Stream 机器人、accessToken 对应的应用一致。\n"
                + "也可先用工作台上传：`/workbench/manager/chat`。",
            });
            return;
          }
          let downloaded;
          try {
            const accessToken = String(await client.getAccessToken());
            downloaded = await fetchDingTalkFile({
              downloadCode,
              robotCode,
              accessToken,
              maxBytes: 4 * 1024 * 1024,
            });
          } catch (err) {
            const reason = err instanceof Error ? err.message : String(err);
            const resolveMeta = err instanceof DingTalkFileDownloadError ? err.resolveMeta : undefined;
            const robotCodePrefix =
              robotCode.length > 12 ? `${robotCode.slice(0, 12)}…` : robotCode;
            logStructured({
              event: "dingtalk_roster_download_failed",
              messageId,
              planId: session.planId,
              filename,
              reason,
              conversationType: convType || undefined,
              robotCodePrefix,
              apiErrcode: resolveMeta?.apiErrcode,
              apiErrmsg: resolveMeta?.apiErrmsg,
              rawSnippet: resolveMeta?.rawSnippet?.slice(0, 200),
            });
            const robotCodeHint =
              /40078/i.test(reason) || /robotcode/i.test(reason)
                ? "\n\n**提示**：若错误涉及 **robotCode**（例如 `40078` / `invalidParameter.robotCode`），请核对 **`DINGTALK_ROBOT_CODE`** 与 **`DINGTALK_CLIENT_ID`/`SECRET` 换取的 accessToken** 是否指向**同一钉钉开放平台应用**（换链接口与 Stream 机器人必须使用同一套应用凭证）。\n"
                : "";
            dingtalkResponse = await sendMarkdownReply({
              client, sessionWebhook, messageId, senderStaffId,
              title: "文件下载失败",
              markdownText:
                `**下载失败**：${reason}\n\n`
                + robotCodeHint
                + "钉钉文档：**人与机器人的会话**里机器人可以接收文件；出现 **HTTP 400** 时优先排查下面几项（与是否群聊无必然关系）：\n"
                + "1. **`DINGTALK_ROBOT_CODE`** 是否为本应用在「机器人名词表」里的 **robotCode**（多为 `ding` 开头），且与当前收消息的机器人是同一个；\n"
                + "2. **accessToken** 是否来自同一套 `DINGTALK_CLIENT_ID` / `SECRET` 对应的应用（换链与 Stream 必须同一应用）；\n"
                + "3. 若接口返回 `invalidParameter.robotCode.auth` 等，多为 **robotCode 与 downloadCode 所属企业/机器人不一致**。\n\n"
                + "仍失败可改用工作台：`/workbench/manager/chat` →「上传花名册」。",
            });
            return;
          }
          const parsed = await parseRosterFile({
            filename: downloaded.filename || filename,
            mimeType: downloaded.mimeType,
            buffer: downloaded.buffer,
            maxBytes: 2 * 1024 * 1024,
          });
          if (!parsed.ok) {
            logStructured({
              event: "dingtalk_roster_parse_rejected",
              messageId,
              planId: session.planId,
              filename: downloaded.filename || filename,
              reason: parsed.reason,
              bytes: parsed.bytes,
            });
            dingtalkResponse = await sendMarkdownReply({
              client, sessionWebhook, messageId, senderStaffId,
              title: "花名册无法解析",
              markdownText: `**解析失败**：${parsed.message}`,
            });
            return;
          }
          session = {
            ...session,
            pendingRosterText: parsed.text,
            pendingRosterSource: parsed.sourceLabel,
          };
          planSessionStore.save(session);
          planSessionStore.appendEvent({
            planId: session.planId,
            chatKeyHash: session.chatKeyHash,
            eventType: "dingtalk_roster_uploaded",
            payload: {
              filename: downloaded.filename || filename,
              kind: parsed.kind,
              chars: parsed.chars,
              bytes: parsed.bytes,
              actorUserId: senderStaffId,
            },
          });
          logStructured({
            event: "dingtalk_roster_uploaded",
            messageId,
            planId: session.planId,
            filename: downloaded.filename || filename,
            kind: parsed.kind,
            chars: parsed.chars,
            bytes: parsed.bytes,
          });
          const hasDraftAlready =
            !!session.latestDraft &&
            Array.isArray((session.latestDraft as { tasks?: unknown }).tasks) &&
            ((session.latestDraft as { tasks: unknown[] }).tasks?.length ?? 0) > 0;
          const rosterAckText = hasDraftAlready
            ? `**已收到名单**：\`${downloaded.filename || filename}\`（${parsed.kind}，${parsed.chars} 字符）。\n\n` +
              `检测到本会话**已有任务草案**。如希望按这份名单重选人选，请直接说**“按这份名单选人”**或**“用刚上传的名单匹配指派”**；如要新开任务，直接描述新任务即可（同一份名单仍会自动用于指派）。`
            : `**已收到名单**：\`${downloaded.filename || filename}\`（${parsed.kind}，${parsed.chars} 字符）。\n\n` +
              `请在下一条消息**描述要分配的任务**，我会按这份名单核对并把指派范围限定在表里出现的人；若你之后改主意，可直接说**“不用这份名单”**重置。`;
          // 把这条系统回复持久化进 conversationHistory，避免下一轮 orchestrator
          // 看不到「刚才传了名单」的上下文导致模型反过来再反问主管要姓名 / 上传名册。
          const userPlaceholder = `[uploaded_file] ${downloaded.filename || filename}（${parsed.kind}，${parsed.chars} 字符）`;
          const nextHistoryAfterUpload = [
            ...session.conversationHistory,
            { role: "user" as const, content: userPlaceholder },
            { role: "assistant" as const, content: rosterAckText },
          ].slice(-10);
          session = { ...session, conversationHistory: nextHistoryAfterUpload };
          planSessionStore.save(session);
          dingtalkResponse = await sendMarkdownReply({
            client, sessionWebhook, messageId, senderStaffId,
            title: "已收到花名册",
            markdownText: rosterAckText,
          });
          return;
        }

        const selectedProfile = routing.selectedProfile;
        const previousProfile = session.lastAgentProfile;
        if (previousProfile && previousProfile !== selectedProfile) {
          // 防止跨角色（employee/manager/planner）时被旧会话语气与意图污染。
          session = {
            ...session,
            conversationHistory: [],
          };
          logStructured({
            event: "dingtalk_profile_switched",
            messageId,
            planId: session.planId,
            fromProfile: previousProfile,
            toProfile: selectedProfile,
          });
        }

        const memoryContext = isAnonymousSender
          ? { summary: "", facts: [] as string[] }
          : loadMemoryContextForPlan(session.planId);
        let mutableKnownFacts = [...(session.knownFacts ?? [])];
        const knownFactsStore: KnownFactsStore = {
          get: () => mutableKnownFacts,
          update: (facts: string[]) => {
            const merged = Array.from(new Set([
              ...mutableKnownFacts,
              ...facts.map((f) => String(f).trim()).filter(Boolean),
            ])).slice(-50);
            mutableKnownFacts = merged;
          },
        };
        let publishResult: Record<string, unknown> | undefined;

        // Run ReAct orchestrator — 模型自主决定追问/搜索/出稿
        logStructured({
          event: "dingtalk_role_routing",
          messageId,
          senderStaffIdMasked: maskUserId(senderStaffId),
          resolvedRole: routing.resolvedRole,
          selectedProfile,
          routingEnabled: routing.roleRoutingEnabled,
          reason: routing.reason,
        });
        const orchestratorStartedAt = Date.now();
        // 检测上一轮是否发生了 scope 切换（发布后自动轮转 / 手动 start_new_task）。
        // conversationHistory 以 [system_note] 开头且 <= 3 条记录 → 上一轮刚发生了 scope 切换。
        const scopeRotatedSinceLastTurn = (() => {
          const hist = session.conversationHistory;
          if (hist.length === 0) return undefined;
          const first = hist[0];
          if (typeof first.content !== "string" || !first.content.startsWith("[system_note]")) return undefined;
          if (hist.length > 3) return undefined;
          const trail = session.scopeAuditTrail ?? [];
          const last = trail[trail.length - 1];
          if (last && (last.eventType === "SCOPE_CREATED" || last.eventType === "SCOPE_RESTORED")) {
            const fromScopeId = last.fromScopeId;
            const fromLabel = fromScopeId ? session.taskScopes?.[fromScopeId]?.scopeLabel : undefined;
            return { fromLabel, toLabel: last.scopeLabel };
          }
          return {};
        })();
        const buildOrchestratorConfig = () => ({
          clientConfig: dingtalkQwenConfig,
          employeeRepo,
          maxToolIterations: dingtalkOrchestratorMaxIterations,
          toolProfile: routing.toolProfile,
          promptProfile: routing.promptProfile,
          managerFollowup:
            routing.toolProfile === "manager" || routing.toolProfile === "admin",
          trustedActorUserId: routing.trustedActorUserId,
          allowSearchWeb: isExplicitSearchRequest(background),
          knownFactsStore,
          currentSessionPlanId: session.planId,
          currentSession: session,
          publishRecentStore,
          actorName: (payload.senderNick as string | undefined)?.trim(),
          actorRole:
            routing.resolvedRole === "admin"
              ? ("admin" as const)
              : routing.resolvedRole === "manager"
                ? ("manager" as const)
                : ("employee" as const),
          onPublishTaskResult: (result: Record<string, unknown>) => {
            publishResult = result;
          },
          onSessionMutated: (mutated) => {
            session = mutated;
            mutableKnownFacts = [...(mutated.knownFacts ?? [])];
          },
          sessionContext: {
            conversationHistory: session.conversationHistory,
            planId: session.planId,
            latestDraft: session.latestDraft,
            latestAssignment: session.latestAssignment,
            memorySummary: memoryContext.summary || buildMemorySummary(session),
            memoryFacts: [...mutableKnownFacts].slice(0, 8),
            currentTimeIso: new Date().toISOString(),
            pendingRoster: session.pendingRosterText
              ? {
                  sourceLabel: session.pendingRosterSource ?? "uploaded:roster",
                  chars: session.pendingRosterText.length,
                }
              : undefined,
            candidatePool: session.candidatePool
              ? {
                  source: session.candidatePool.source,
                  entries: session.candidatePool.entries.map((e) => ({
                    userId: e.userId,
                    displayName: e.displayName,
                  })),
                  unresolvedCount: session.candidatePool.unresolved?.length,
                }
              : undefined,
            scopeRotatedSinceLastTurn,
          },
        });
        const preTurnDraft = session.latestDraft;
        const preTurnAssignment = session.latestAssignment;
        let orchResult = await runOrchestrator(background, buildOrchestratorConfig());
        let orchestratorMs = Date.now() - orchestratorStartedAt;

        // Layer-3：scope 切换口播未调 start_new_task 时重试（与发布无关，保留）。
        {
          const initialOutbound = orchResult.messages.join("\n\n");
          const isFalseScopeSwitch = detectFalseScopeSwitch({
            userMessage: background,
            toolInvocationNames: orchResult.toolInvocationNames ?? [],
            outboundMarkdown: initialOutbound,
          });
          if (isFalseScopeSwitch) {
            logStructured({
              event: "scope_switch_silent_skip_detected",
              messageId,
              traceId: orchResult.traceId,
              planId: session.planId,
              initialToolNames: [...(orchResult.toolInvocationNames ?? [])],
              initialMessagePreview: initialOutbound.slice(0, 160),
            });
            const retryStartedAt = Date.now();
            const retryBackground = buildScopeSwitchRetryUserMessage(background);
            const retryResult = await runOrchestrator(retryBackground, buildOrchestratorConfig());
            orchestratorMs += Date.now() - retryStartedAt;
            logStructured({
              event: "scope_switch_silent_skip_retry_done",
              messageId,
              traceId: retryResult.traceId,
              retriedToolNames: [...(retryResult.toolInvocationNames ?? [])],
              retryMessagePreview: retryResult.messages.join("\n\n").slice(0, 160),
            });
            orchResult = retryResult;
          }
        }

        // 用户要求换题/新任务但未调 start_new_task → 重试一轮（与假 scope 口播互补）。
        {
          if (
            detectTopicSwitchWithoutArchive({
              userMessage: background,
              preTurnLatestDraft: preTurnDraft,
              toolInvocationNames: orchResult.toolInvocationNames ?? [],
            })
          ) {
            logStructured({
              event: "topic_switch_without_archive_detected",
              messageId,
              traceId: orchResult.traceId,
              planId: session.planId,
            });
            const retryStartedAt = Date.now();
            const retryBackground = buildTopicSwitchRetryUserMessage(background);
            const retryResult = await runOrchestrator(retryBackground, buildOrchestratorConfig());
            orchestratorMs += Date.now() - retryStartedAt;
            logStructured({
              event: "topic_switch_without_archive_retry_done",
              messageId,
              traceId: retryResult.traceId,
              retriedToolNames: [...(retryResult.toolInvocationNames ?? [])],
            });
            orchResult = retryResult;
          }
        }

        // CLARIFY 语气与 draft JSON 混写 → 内部重试一轮（不追加用户可见兜底文案）。
        {
          const initialOutbound = orchResult.messages.join("\n\n");
          const hasDraftOutput = orchResult.draft !== undefined;
          if (
            detectDraftClarifyMix({
              message: initialOutbound,
              hasDraft: hasDraftOutput,
            })
          ) {
            logStructured({
              event: "draft_clarify_mix_detected",
              messageId,
              traceId: orchResult.traceId,
              planId: session.planId,
              messagePreview: initialOutbound.slice(0, 160),
            });
            const retryStartedAt = Date.now();
            const retryBackground = buildDraftClarifyMixRetryUserMessage(background);
            const retryResult = await runOrchestrator(retryBackground, buildOrchestratorConfig());
            orchestratorMs += Date.now() - retryStartedAt;
            logStructured({
              event: "draft_clarify_mix_retry_done",
              messageId,
              traceId: retryResult.traceId,
              retriedToolNames: [...(retryResult.toolInvocationNames ?? [])],
              retryMessagePreview: retryResult.messages.join("\n\n").slice(0, 160),
            });
            orchResult = retryResult;
          }
        }

        // 假发布观测：主管确认发布但模型未调 publish_task 却口播「已发布」→ 审计 + 用户提示，不替模型重试。
        {
          const initialOutbound = orchResult.messages.join("\n\n");
          const falsePublish =
            detectFalsePublish({
              userMessage: background,
              preTurnLatestDraft: preTurnDraft,
              toolInvocationNames: orchResult.toolInvocationNames ?? [],
              hasPublishResult: publishResultSucceeded(publishResult as Record<string, unknown> | undefined),
              outboundMarkdown: initialOutbound,
            })
            || detectFalsePublishOnConfirm({
              userMessage: background,
              preTurnLatestDraft: preTurnDraft,
              toolInvocationNames: orchResult.toolInvocationNames ?? [],
              hasPublishResult: publishResultSucceeded(publishResult as Record<string, unknown> | undefined),
              outboundMarkdown: initialOutbound,
            });
          if (falsePublish) {
            logStructured({
              event: "false_publish_observed",
              messageId,
              traceId: orchResult.traceId,
              planId: session.planId,
              initialMessagePreview: initialOutbound.slice(0, 160),
            });
          }
        }

        const snapshotPlanId = session.planId;
        const postTurnDraft = session.latestDraft;

        const applyDraftFromOrchestrator = (result: typeof orchResult) => {
          const outbound = resolveDraftForOutbound({
            preTurnDraft,
            postTurnDraft: session.latestDraft,
            orchResultDraft: result.draft as Record<string, unknown> | undefined,
            toolInvocationNames: result.toolInvocationNames ?? [],
          });
          if (outbound.persistedDraft) {
            session.latestDraft = outbound.persistedDraft as PlanSession["latestDraft"];
          }
          return outbound;
        };

        let draftOutbound = applyDraftFromOrchestrator(orchResult);
        let { draftTouchedThisTurn, draftForRender, persistedDraft } = draftOutbound;

        const employeesForAssignment = employeeRepo.list().map((e) => ({
          userId: e.userId,
          displayName: e.displayName,
        }));

        const runAssignmentProcessing = (result: typeof orchResult, outbound: typeof draftOutbound) => {
          const assignmentDraft = outbound.draftForRender ?? outbound.persistedDraft;
          const taskIds = Array.isArray((assignmentDraft as { tasks?: unknown[] } | undefined)?.tasks)
            ? ((assignmentDraft as { tasks: Array<{ id?: string }> }).tasks)
                .map((t) => (typeof t?.id === "string" ? t.id : ""))
                .filter((id) => id.length > 0)
            : [];
          return processAssignmentForTurn({
            preTurnDraft: preTurnDraft as Record<string, unknown> | undefined,
            persistedDraft: outbound.persistedDraft as Record<string, unknown> | undefined,
            sessionAssignment: session.latestAssignment as Record<string, unknown> | undefined,
            orchAssignment: result.assignment,
            draftTouchedThisTurn: outbound.draftTouchedThisTurn,
            planId: session.planId,
            traceId: result.traceId,
            modelName: dingtalkQwenConfig.model,
            taskIds,
            employees: employeesForAssignment,
            candidatePoolUserIds: session.candidatePool?.entries.map((e) => e.userId),
            requireFullCoverage: true,
          });
        };

        const assignmentStartedAt = Date.now();
        let assignState = runAssignmentProcessing(orchResult, draftOutbound);

        const needsAssignRetry =
          process.env.ASSIGNMENT_PHASE_ENABLED === "1"
          && hasAssigneeIntentInUserMessage(background)
          && assignState.coverage.total > 0
          && assignState.coverage.covered < assignState.coverage.total;

        if (needsAssignRetry) {
          logStructured({
            event: "assign_partial_retry",
            messageId,
            traceId: orchResult.traceId,
            missingTaskIds: assignState.missingTaskIds,
            covered: assignState.coverage.covered,
            total: assignState.coverage.total,
          });
          const retryStartedAt = Date.now();
          const retryBackground = buildAssignRetryUserMessage({
            originalUserMessage: background,
            missingTaskIds: assignState.missingTaskIds,
            taskIndexMap: buildTaskIndexMap(persistedDraft as Record<string, unknown> | undefined),
          });
          orchResult = await runOrchestrator(retryBackground, buildOrchestratorConfig());
          orchestratorMs += Date.now() - retryStartedAt;
          draftOutbound = applyDraftFromOrchestrator(orchResult);
          ({ draftTouchedThisTurn, draftForRender, persistedDraft } = draftOutbound);
          assignState = runAssignmentProcessing(orchResult, draftOutbound);
        }

        let latestAssignment = assignState.latestAssignment ?? (preTurnAssignment as Record<string, unknown> | undefined);
        let assignmentSection = assignState.assignmentSection;
        if (latestAssignment) {
          session.latestAssignment = latestAssignment as PlanSession["latestAssignment"];
        }

        const showAssignment =
          process.env.ASSIGNMENT_PHASE_ENABLED === "1"
          && (draftForRender ?? persistedDraft);
        if (showAssignment && assignState.lightDraft && !isAnonymousSender) {
          planSessionStore.appendEvent({
            planId: session.planId,
            chatKeyHash: session.chatKeyHash,
            eventType: "ASSIGNMENT_UPDATED",
            payload: {
              traceId: orchResult.traceId,
              assignmentCount: assignState.lightDraft.assignments.length,
            },
          });
          try {
            await assignmentDraftRepo.save(
              assignState.lightDraft as unknown as { planId: string; traceId: string; promptVersion: string },
            );
            await assignmentEventRepo.append({
              eventType: "ASSIGNMENT_DRAFT_GENERATED",
              traceId: orchResult.traceId,
              planId: assignState.lightDraft.planId,
              assignmentCount: assignState.lightDraft.assignments.length,
              promptVersion: assignState.lightDraft.promptVersion,
              modelName: assignState.lightDraft.modelName,
              occurredAt: new Date().toISOString(),
            });
          } catch (persistErr) {
            logStructured({
              event: "dingtalk_assignment_persist_failed",
              traceId: orchResult.traceId,
              reason: persistErr instanceof Error ? persistErr.message : String(persistErr),
            });
          }
        } else if (assignState.extractReason && orchResult.assignment !== undefined) {
          logStructured({
            event: "dingtalk_assignment_light_validation_failed",
            traceId: orchResult.traceId,
            reason: assignState.extractReason,
            missingTaskIds: assignState.missingTaskIds,
          });
        }
        const assignmentMs = Date.now() - assignmentStartedAt;

        // 长期记忆：有草案时自动存快照+embedding
        if (persistedDraft && !isAnonymousSender) {
          savePlanSnapshot(snapshotPlanId, {
            planId: snapshotPlanId,
            traceId: orchResult.traceId,
            status: "DRAFT_READY",
            draft: persistedDraft,
            messagePreview: orchResult.messages[0]?.slice(0, 500),
          });
          savePlanSnapshot(orchResult.traceId, {
            traceId: orchResult.traceId,
            status: "DRAFT_READY",
            draft: persistedDraft,
            messagePreview: orchResult.messages[0]?.slice(0, 500),
          });
          // 生成 embedding 用于未来相似任务检索
          if (readSearchSimilarPlansEnabled()) {
            const summary = `领域:${(persistedDraft as any)?.classification?.domain ?? "未知"} 子类型:${(persistedDraft as any)?.classification?.subtype ?? "未知"}`;
            generateQueryEmbedding(summary).then((emb) => {
              if (emb) {
                savePlanEmbedding(orchResult.traceId, summary, emb);
                savePlanEmbedding(snapshotPlanId, summary, emb);
              }
            }).catch(() => {});
          }
        }

        let outboundMarkdown = orchResult.messages.join("\n\n");
        if (!outboundMarkdown.trim()) outboundMarkdown = "已收到，正在处理中。";
        const sanitizedOutbound = sanitizeToolNameLeak(outboundMarkdown);
        const leakedToolName = sanitizedOutbound.leaked ? sanitizedOutbound.toolName : undefined;
        if (sanitizedOutbound.leaked) {
          logStructured({
            event: "dingtalk_tool_name_leak",
            messageId,
            traceId: orchResult.traceId,
            toolName: sanitizedOutbound.toolName,
          });
          outboundMarkdown = sanitizedOutbound.markdown;
        }

        let planRotatedAfterPublish = false;
        let rotatePlanHintTail = "";
        const pr = publishResult as Record<string, unknown> | undefined;
        if (
          readDingtalkPlanIdRotateEnabled() &&
          !isAnonymousSender &&
          pr &&
          String(pr.ok ?? "") === "true" &&
          String(pr.alreadyPublished ?? "") !== "true" &&
          pr.dedupedByLru !== true &&
          String(pr.reason ?? "") !== "unknown_assignees"
        ) {
          const taskRow = pr.task as { taskNo?: string } | undefined;
          const taskNo = String(taskRow?.taskNo ?? "").trim();
          const rotRes = markPublishedAndRotatePlanSession(session, {
            taskNo,
            scopeLabel: "（发布后新规划）",
            reason: "auto_rotate_after_publish",
          });
          if (!("skipped" in rotRes)) {
            planRotatedAfterPublish = true;
            rotatePlanHintTail =
              `\n\n---\n**已切换到新任务上下文**：接下来您发的内容会按**新任务**继续编排。\n` +
              (taskNo ?
                `刚才那条已发布的任务业务编号为 **${taskNo}**。若还要继续改那条任务的拆解或分配，请直接回复一句：**切回上一条任务**（或说明要接着改刚才那条）。\n`
              : `若还要继续改刚才那条任务的拆解或分配，请直接回复一句：**切回上一条任务**。\n`);
            planSessionStore.appendEvent({
              planId: rotRes.toPlanId,
              chatKeyHash: session.chatKeyHash,
              eventType: "planid_rotated_after_publish",
              payload: {
                fromPlanId: rotRes.fromPlanId,
                toPlanId: rotRes.toPlanId,
                taskNo: taskNo || undefined,
                traceId: orchResult.traceId,
              },
            });
            logStructured({
              event: "planid_rotated_after_publish",
              messageId,
              fromPlanId: rotRes.fromPlanId,
              toPlanId: rotRes.toPlanId,
              taskNo: taskNo || undefined,
              traceId: orchResult.traceId,
            });
          }
        }

        const shouldRenderRichSection = Boolean(draftForRender) && !planRotatedAfterPublish;
        const renderedTaskTable =
          shouldRenderRichSection &&
          appendStructuredTaskTable &&
          Array.isArray((draftForRender as { tasks?: unknown[] })?.tasks) &&
          ((draftForRender as { tasks: unknown[] }).tasks?.length ?? 0) > 0;
        if (
          !publishResultSucceeded(publishResult as Record<string, unknown> | undefined)
          && (detectFalsePublish({
            userMessage: background,
            preTurnLatestDraft: preTurnDraft,
            toolInvocationNames: orchResult.toolInvocationNames ?? [],
            hasPublishResult: false,
            outboundMarkdown: outboundMarkdown,
          })
            || detectFalsePublishOnConfirm({
              userMessage: background,
              preTurnLatestDraft: preTurnDraft,
              toolInvocationNames: orchResult.toolInvocationNames ?? [],
              hasPublishResult: false,
              outboundMarkdown: outboundMarkdown,
            }))
        ) {
          outboundMarkdown = `${outboundMarkdown.trim()}${formatFalsePublishObservedNotice()}`;
        }
        if (
          detectFalseAssign({
            userMessage: background,
            latestDraft: persistedDraft as Record<string, unknown> | undefined,
            latestAssignment,
            outboundMarkdown,
            hasFullAssignmentJson: assignState.extractOk,
          })
        ) {
          outboundMarkdown = `${outboundMarkdown.trim()}${formatFalseAssignObservedNotice({
            missingTaskIds: assignState.missingTaskIds,
          })}`;
          logStructured({
            event: "false_assign_observed",
            messageId,
            traceId: orchResult.traceId,
            missingTaskIds: assignState.missingTaskIds,
          });
        }
        // 正确拼接顺序（renderDingtalkTaskMarkdown 内部保证）：
        //   富字段段 → 分配建议 → 发布回执 → 轮转提示
        const finalOutboundForHistory = renderDingtalkTaskMarkdown({
          modelMessage: outboundMarkdown,
          currentDraft: draftForRender,
          latestAssignment,
          shouldRenderRichSection,
          appendStructuredTaskTable,
          onModelDrewTable: () => {
            logStructured({
              event: "dingtalk_model_drew_task_table",
              messageId,
              traceId: orchResult.traceId,
            });
          },
          assignmentSection,
          publishResult: publishResult as Record<string, unknown> | undefined,
          rotatePlanHintTail: planRotatedAfterPublish ? rotatePlanHintTail : "",
        });
        // history 中只保留模型原话（不含本轮 bot 渲染的「任务补充信息」/ 结构化任务表 / 分配建议段），
        // 否则下一轮模型读 conversationHistory 会把上一轮的 latestDraft.description 等内容
        // 一字不漏地「复读」到新回复里造成跨任务串台（即用户看到的污染）。
        const pureAssistantMessageForHistory = leakedToolName ? TOOL_NAME_LEAK_FALLBACK : orchResult.messages.join("\n\n").trim() ||
          "（已收到）";
        const sendReplyStartedAt = Date.now();
        dingtalkResponse = await sendMarkdownReply({
          client,
          sessionWebhook,
          messageId,
          senderStaffId,
          title: draftForRender ? "任务拆解草案" : "消息",
          markdownText: truncateMarkdown(finalOutboundForHistory, MAX_MARKDOWN_CHARS),
        });
        const sendReplyMs = Date.now() - sendReplyStartedAt;
        const totalMs = Date.now() - handlerStartedAt;
        logStructured({
          event: "dingtalk_handler_timing",
          traceId: orchResult.traceId,
          messageId,
          selectedProfile,
          hasDraft: persistedDraft !== undefined,
          draftTouchedThisTurn,
          renderedTaskTable,
          hasAssignmentSection: assignmentSection.length > 0,
          orchestratorMs,
          assignmentMs,
          sendReplyMs,
          totalMs,
        });

        const nextRevisionEvents = [
          ...(session.revisionEvents ?? []),
          {
            occurredAt: new Date().toISOString(),
            eventType: draftTouchedThisTurn ? "DRAFT_UPDATED" : "MESSAGE_ONLY",
            userInput: background.slice(0, 2000),
            traceId: orchResult.traceId,
          },
        ].slice(-30);
        const nextConversationHistory = [
          ...session.conversationHistory,
          { role: "user" as const, content: background },
          { role: "assistant" as const, content: pureAssistantMessageForHistory },
        ].slice(-10);
        if (!isAnonymousSender) {
          planSessionStore.save({
            ...session,
            lastAgentProfile: selectedProfile,
            conversationId: conversationId || session.conversationId,
            conversationType: conversationType || session.conversationType,
            senderStaffId: senderStaffId || session.senderStaffId,
            sessionWebhookLastSeen: sessionWebhook || session.sessionWebhookLastSeen,
            lastTraceId: orchResult.traceId,
            knownFacts: mutableKnownFacts,
            conversationHistory: nextConversationHistory,
            latestDraft: planRotatedAfterPublish ? undefined : persistedDraft,
            latestAssignment: planRotatedAfterPublish ? undefined : latestAssignment,
            revisionEvents: nextRevisionEvents,
          });
        }

        if (!isAnonymousSender) {
          const memoryPlanId = planRotatedAfterPublish ? snapshotPlanId : session.planId;
          appendMemoryEvents({
            planId: memoryPlanId,
            userMessage: background,
            assistantMessage: pureAssistantMessageForHistory,
            latestDraft: persistedDraft,
            latestAssignment,
            traceId: orchResult.traceId,
            modelConfig: {
              apiKey: dingtalkQwenConfig.apiKey,
              baseUrl: dingtalkQwenConfig.baseUrl,
              timeoutMs: dingtalkQwenConfig.timeoutMs,
            },
          }).catch((err) => {
            logStructured({
              event: "memory_worker_failed",
              planId: memoryPlanId,
              traceId: orchResult.traceId,
              reason: err instanceof Error ? err.message : String(err),
            });
          });
        }

      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error("[dingtalk-bot] handler error:", msg);
        logStructured({
          event: "dingtalk_handler_error",
          messageId,
          reason: msg,
        });
        try {
          const fallback = JSON.parse(res.data) as Record<string, unknown>;
          if (fallback.sessionWebhook && fallback.senderStaffId) {
            dingtalkResponse = await sendMarkdownReply({
              client,
              sessionWebhook: String(fallback.sessionWebhook ?? ""),
              messageId,
              senderStaffId: String(fallback.senderStaffId ?? ""),
              title: "内部错误",
              markdownText: `处理消息时出错：${msg}`,
            });
          }
        } catch {
          // ignore secondary failure
        }
      } finally {
        if (!streamAckSent) {
          ackStreamRobot(client, messageId);
        }
      }
    })();
  });

  client
    .registerAllEventListener(() => ({ status: EventAck.SUCCESS }))
    .connect();

  console.info(
    "[dingtalk-bot] Stream 已连接；向机器人发送文本即可触发任务拆解（模型调用较慢时请勿重复刷屏）。"
  );
}

if (process.env.NODE_ENV !== "test") {
  main().catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
}

/**
 * 文件下载接口要求的是开放平台「机器人 robotCode」（多为 `ding` 开头），
 * 不是 OAuth 的 Client ID。若环境变量误填纯数字，易被当成 AppKey/ClientId 而触发 HTTP 400。
 */
function resolveDingTalkRobotCodeForFileDownload(payload: Record<string, unknown>): string | undefined {
  const fileContent = (payload as { content?: Record<string, unknown> }).content ?? {};
  const fromPayload = String(
    fileContent.robotCode ??
      payload.robotCode ??
      payload.chatbotUserId ??
      (payload as { chatBotUserId?: unknown }).chatBotUserId ??
      "",
  ).trim();
  const fromEnv = process.env.DINGTALK_ROBOT_CODE?.trim();
  const envLooksLikeNumericClientId = Boolean(fromEnv && /^\d+$/.test(fromEnv));
  if (fromEnv && !envLooksLikeNumericClientId) return fromEnv;
  if (fromPayload) return fromPayload;
  if (fromEnv && envLooksLikeNumericClientId) return undefined;
  return undefined;
}

function buildMemorySummary(session: PlanSession): string {
  const lines: string[] = [`planId=${session.planId}`];
  if (session.lastTraceId) lines.push(`lastTraceId=${session.lastTraceId}`);
  return lines.join("; ");
}
