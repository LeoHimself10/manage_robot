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
  isDingtalkRoleRoutingEnabled,
  resolveDingtalkAgentRouting,
} from "./agent/role-routing";
import { extractLightAssignment, renderLightAssignmentSection } from "./agent/assignment/light-assignment";
import { savePlanSnapshot } from "./infra/plan-store";
import { savePlanEmbedding, generateQueryEmbedding } from "./infra/plan-index";
import { createPlanSessionStore, hashChatKey, type PlanSession } from "./infra/plan-session-store";
import { logStructured } from "./infra/logger";
import { createDingTalkContactSyncService } from "./infra/dingtalk-contact-sync";
import {
  appendMemoryEvents,
  loadMemoryContextForPlan,
} from "./infra/workbench-memory-store";
import { createRecentPublishStore } from "./agent/tools/publish-task";
import type { KnownFactsStore } from "./agent/tools/update-known-facts";

/** 钉钉 markdown 单条上限约 2 万字符，预留余量避免被拒收 */
const MAX_MARKDOWN_CHARS = 18_000;
const DEFAULT_DINGTALK_MAX_TOKENS = 2200;
const DEFAULT_DINGTALK_ORCH_ITERATIONS = 3;
const DEFAULT_DINGTALK_TIMEOUT_MS = 90000;

function truncateMarkdown(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const suffix = "\n\n_(内容过长，已截断展示；完整草案见结构化任务表。)_";
  const budget = Math.max(0, maxChars - suffix.length);
  return text.slice(0, budget) + suffix;
}

function hasTaskTableInMessage(markdown: string): boolean {
  const normalized = markdown.toLowerCase();
  return (
    normalized.includes("### 任务列表（结构化字段）") ||
    normalized.includes("| # | 任务 | 目标 | 交付物 | 完成标准 | 截止日期 | 反馈频率 |") ||
    normalized.includes("| 序号 | 任务名称 |")
  );
}

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

export function appendPublishSummaryMarkdown(
  outboundMarkdown: string,
  publishResult?: Record<string, unknown>,
): string {
  if (!publishResult || String((publishResult as any).ok ?? "") !== "true") return outboundMarkdown;
  const publishTaskNo = String((publishResult as any)?.task?.taskNo ?? "").trim();
  if (String((publishResult as any).alreadyPublished ?? "") === "true") {
    if (publishTaskNo) {
      return `${outboundMarkdown}\n\n【已发布】此计划已发布过（任务编号 ${publishTaskNo}），未重复推送。`;
    }
    return `${outboundMarkdown}\n\n【已发布】此计划已发布过，未重复推送。`;
  }
  const subtaskCount = Array.isArray((publishResult as any).subtasks)
    ? (publishResult as any).subtasks.length
    : 0;
  const assignees = new Set<string>(
    Array.isArray((publishResult as any).subtasks)
      ? (publishResult as any).subtasks.map((s: any) => String(s?.assigneeUserId ?? "").trim()).filter(Boolean)
      : [],
  );
  const warningText = Array.isArray((publishResult as any).warnings)
    ? (publishResult as any).warnings.join("；")
    : "";
  let next = `${outboundMarkdown}\n\n【已发布】任务编号 ${publishTaskNo || "未知"}\n标题：${String((publishResult as any)?.task?.title ?? "未命名任务")}\n子任务 ${subtaskCount} 个 → 已通知 ${assignees.size} 名员工`;
  if (warningText) next += `\n${warningText}`;
  return next;
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
  toolProfile: "planner" | "manager" | "employee" | "full";
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
    false,
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
        const orchResult = await runOrchestrator(background, {
          clientConfig: dingtalkQwenConfig,
          employeeRepo,
          maxToolIterations: dingtalkOrchestratorMaxIterations,
          toolProfile: routing.toolProfile,
          promptProfile: routing.promptProfile,
          trustedActorUserId: routing.trustedActorUserId,
          allowSearchWeb: isExplicitSearchRequest(background),
          knownFactsStore,
          currentSessionPlanId: session.planId,
          currentSession: session,
          publishRecentStore,
          actorName: (payload.senderNick as string | undefined)?.trim(),
          onPublishTaskResult: (result) => {
            publishResult = result;
          },
          sessionContext: {
            conversationHistory: session.conversationHistory,
            planId: session.planId,
            latestDraft: session.latestDraft,
            latestAssignment: session.latestAssignment,
            memorySummary: memoryContext.summary || buildMemorySummary(session),
            memoryFacts: [...memoryContext.facts, ...mutableKnownFacts].slice(0, 8),
            currentTimeIso: new Date().toISOString(),
          },
        });
        const orchestratorMs = Date.now() - orchestratorStartedAt;

        const currentDraft = orchResult.draft ?? session.latestDraft;

        // 长期记忆：有草案时自动存快照+embedding
        if (currentDraft && !isAnonymousSender) {
          savePlanSnapshot(session.planId, {
            planId: session.planId,
            traceId: orchResult.traceId,
            status: "DRAFT_READY",
            draft: currentDraft,
            messagePreview: orchResult.messages[0]?.slice(0, 500),
          });
          savePlanSnapshot(orchResult.traceId, {
            traceId: orchResult.traceId,
            status: "DRAFT_READY",
            draft: currentDraft,
            messagePreview: orchResult.messages[0]?.slice(0, 500),
          });
          // 生成 embedding 用于未来相似任务检索
          const summary = `领域:${(currentDraft as any)?.classification?.domain ?? "未知"} 子类型:${(currentDraft as any)?.classification?.subtype ?? "未知"}`;
          generateQueryEmbedding(summary).then((emb) => {
            if (emb) {
              savePlanEmbedding(orchResult.traceId, summary, emb);
              savePlanEmbedding(session.planId, summary, emb);
            }
          }).catch(() => {});
        }

        // 模型自己决定输出格式，代码只做兜底
        let outboundMarkdown = orchResult.messages.join("\n\n");
        // 默认不再自动补结构化任务表，避免和模型正文重复；可通过 DINGTALK_APPEND_STRUCTURED_TABLE=1 手动开启。
        if (currentDraft) {
          const tasks = (currentDraft as any)?.tasks;
          if (
            appendStructuredTaskTable &&
            Array.isArray(tasks) &&
            tasks.length > 0 &&
            !hasTaskTableInMessage(outboundMarkdown)
          ) {
            const rows = tasks.map((t: any, i: number) =>
              `| ${i + 1} | ${t.title ?? ""} | ${t.objective ?? ""} | ${(t.deliverables ?? []).join("；") || "-"} | ${(t.completionCriteria ?? []).join("；") || "-"} | ${t.timeNode?.dueAt ?? "待确认"} | ${t.feedbackFrequency ?? "待确认"} |`
            );
            outboundMarkdown += "\n\n### 任务列表（结构化字段）\n| # | 任务 | 目标 | 交付物 | 完成标准 | 截止日期 | 反馈频率 |\n|---|---|---|---|---|---|---|\n" + rows.join("\n");
          }
        }
        if (!outboundMarkdown.trim()) outboundMarkdown = "已收到，正在处理中。";

        const assignmentStartedAt = Date.now();
        let latestAssignment: Record<string, unknown> | undefined = session.latestAssignment;
        let assignmentSection = "";
        if (currentDraft && process.env.ASSIGNMENT_PHASE_ENABLED === "1") {
          const taskIds = Array.isArray((currentDraft as any)?.tasks)
            ? (currentDraft as any).tasks
                .map((t: any) => (typeof t?.id === "string" ? t.id : ""))
                .filter((id: string) => id.length > 0)
            : [];
          const assignmentResult = extractLightAssignment({
            rawAssignment: orchResult.assignment,
            planId: session.planId,
            traceId: orchResult.traceId,
            modelName: dingtalkQwenConfig.model,
            taskIds,
            employees: employeeRepo.list().map((e) => ({
              userId: e.userId,
              displayName: e.displayName,
            })),
          });
          if (assignmentResult.ok) {
            latestAssignment = assignmentResult.draft as unknown as Record<string, unknown>;
            assignmentSection = renderLightAssignmentSection(assignmentResult.draft);
            if (!isAnonymousSender) {
              planSessionStore.appendEvent({
                planId: session.planId,
                chatKeyHash: session.chatKeyHash,
                eventType: "ASSIGNMENT_UPDATED",
                payload: {
                  traceId: orchResult.traceId,
                  assignmentCount: assignmentResult.draft.assignments.length,
                },
              });
              try {
                await assignmentDraftRepo.save(assignmentResult.draft as unknown as { planId: string; traceId: string; promptVersion: string });
                await assignmentEventRepo.append({
                  eventType: "ASSIGNMENT_DRAFT_GENERATED",
                  traceId: orchResult.traceId,
                  planId: assignmentResult.draft.planId,
                  assignmentCount: assignmentResult.draft.assignments.length,
                  promptVersion: assignmentResult.draft.promptVersion,
                  modelName: assignmentResult.draft.modelName,
                  occurredAt: new Date().toISOString(),
                });
              } catch (persistErr) {
                logStructured({
                  event: "dingtalk_assignment_persist_failed",
                  traceId: orchResult.traceId,
                  reason: persistErr instanceof Error ? persistErr.message : String(persistErr),
                });
              }
            }
          } else if (orchResult.assignment !== undefined) {
            logStructured({
              event: "dingtalk_assignment_light_validation_failed",
              traceId: orchResult.traceId,
              reason: assignmentResult.reason,
            });
          }
        }
        const assignmentMs = Date.now() - assignmentStartedAt;

        outboundMarkdown = appendPublishSummaryMarkdown(outboundMarkdown, publishResult);
        const finalOutboundForHistory = outboundMarkdown + assignmentSection;
        const sendReplyStartedAt = Date.now();
        dingtalkResponse = await sendMarkdownReply({
          client,
          sessionWebhook,
          messageId,
          senderStaffId,
          title: currentDraft ? "任务拆解草案" : "消息",
          markdownText: truncateMarkdown(finalOutboundForHistory, MAX_MARKDOWN_CHARS),
        });
        const sendReplyMs = Date.now() - sendReplyStartedAt;
        const totalMs = Date.now() - handlerStartedAt;
        logStructured({
          event: "dingtalk_handler_timing",
          traceId: orchResult.traceId,
          messageId,
          selectedProfile,
          hasDraft: currentDraft !== undefined,
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
            eventType: currentDraft ? "DRAFT_UPDATED" : "MESSAGE_ONLY",
            userInput: background.slice(0, 2000),
            traceId: orchResult.traceId,
          },
        ].slice(-30);
        const nextConversationHistory = [
          ...session.conversationHistory,
          { role: "user" as const, content: background },
          { role: "assistant" as const, content: finalOutboundForHistory },
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
            latestDraft: currentDraft,
            latestAssignment,
            revisionEvents: nextRevisionEvents,
          });
        }

        if (!isAnonymousSender) {
          appendMemoryEvents({
            planId: session.planId,
            userMessage: background,
            assistantMessage: finalOutboundForHistory,
            latestDraft: currentDraft,
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
              planId: session.planId,
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

function buildMemorySummary(session: PlanSession): string {
  const lines: string[] = [`planId=${session.planId}`];
  if (session.lastTraceId) lines.push(`lastTraceId=${session.lastTraceId}`);
  return lines.join("; ");
}
