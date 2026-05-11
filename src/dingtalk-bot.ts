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
  deriveChatSessionKey,
  MemoryChatSessionStore,
  readRateLimitWindowMs,
} from "./infra/session-store";
import {
  type DingTalkDemoSessionContext,
} from "./dingtalk-session-context";
import { resolveEmployeeProfileDir, resolveAssignmentDraftDir, resolveAssignmentEventsPath } from "./infra/assignment-env";
import { createEmployeeProfileRepo } from "./integrations/repos/employee-profile-repo";
import { createAssignmentDraftRepo } from "./integrations/repos/assignment-draft-repo";
import { createAssignmentEventRepo } from "./integrations/repos/assignment-event-repo";
import { runAssignmentRecommendation } from "./agent/assignment/run-assignment-recommendation";
import { handleAssignmentHttp } from "./web/assignment-workbench";
import { runOrchestrator } from "./agent/orchestrator";
import { getSessionKnownFacts } from "./dingtalk-session-context";
import { savePlanSnapshot } from "./infra/plan-store";
import { savePlanEmbedding, generateQueryEmbedding } from "./infra/plan-index";

/** 钉钉 markdown 单条上限约 2 万字符，预留余量避免被拒收 */
const MAX_MARKDOWN_CHARS = 18_000;

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
  return data;
}

function ackCallback(client: DWClient, messageId: string, dingtalkResponse: unknown): void {
  client.socketCallBackResponse(messageId, dingtalkResponse);
}

function startCombinedServer(healthPort: number): void {
  const server = http.createServer((req, res) => {
    if (req.url === "/health" || req.url === "/") {
      res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("ok");
      return;
    }
    if (handleAssignmentHttp(req, res)) return;
    res.writeHead(404);
    res.end();
  });
  server.listen(healthPort, () => {
    console.info(`[health] listening on :${healthPort} (/health)`);
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

  const qwenConfig = loadQwenPlannerConfigFromEnv();
  if (!qwenConfig) {
    console.error(
      "未检测到 QWEN_API_KEY。请在环境变量或 .env 中配置（与 DashScope 一致），切勿提交密钥。"
    );
    process.exitCode = 1;
    return;
  }

  const debug = process.env.DINGTALK_STREAM_DEBUG === "1" || process.env.DINGTALK_STREAM_DEBUG === "true";

  const healthPort = Number(process.env.HEALTH_CHECK_PORT ?? "");
  if (Number.isFinite(healthPort) && healthPort > 0) {
    startCombinedServer(healthPort);
  }

  const client = new DWClient({
    clientId,
    clientSecret,
    debug,
  });

  const chatSessionMemory = new MemoryChatSessionStore<DingTalkDemoSessionContext>();

  client.registerCallbackListener(TOPIC_ROBOT, (res: DWClientDownStream) => {
    void (async () => {
      const messageId = res.headers.messageId;
      let dingtalkResponse: unknown = { errcode: 0, errmsg: "ok" };

      try {
        const payload = JSON.parse(res.data) as Record<string, unknown>;
        const msgtype = String(payload.msgtype ?? "");

        // 提取文本内容：支持 text / paragraph / markdown 等格式
        const textContent =
          (payload as Record<string, unknown>).text as Record<string, unknown> | undefined;
        const content = String(
          textContent?.content ??
          (payload as Record<string, unknown>).content ??
          ""
        ).trim();

        if (!content) {
          dingtalkResponse = await sendMarkdownReply({
            client,
            sessionWebhook: String(payload.sessionWebhook ?? ""),
            messageId,
            senderStaffId: String(payload.senderStaffId ?? ""),
            title: "提示",
            markdownText: "请直接发送任务背景描述，我会帮你拆解为可执行的任务草案。",
          });
          return;
        }

        const background = content;
        const senderStaffId = String(payload.senderStaffId ?? "");
        const sessionWebhook = String(payload.sessionWebhook ?? "");
        const chatKey = deriveChatSessionKey({
          sessionWebhook,
          senderStaffId,
        });

        if (!chatSessionMemory.checkRateLimitThenTouch(chatKey, readRateLimitWindowMs())) {
          dingtalkResponse = await sendMarkdownReply({
            client, sessionWebhook, messageId, senderStaffId,
            title: "请稍后再试",
            markdownText: "**请求过于频繁。** 同一会话在短时间内仅处理一条任务规划，请稍后再发。",
          });
          return;
        }

        const prior = chatSessionMemory.get(chatKey);

        // Run ReAct orchestrator — 模型自主决定追问/搜索/出稿
        const orchResult = await runOrchestrator(background, {
          clientConfig: qwenConfig,
          employeeRepo: createEmployeeProfileRepo(resolveEmployeeProfileDir()),
          sessionContext: {
            knownFacts: getSessionKnownFacts(prior),
            conversationHistory: (prior as any)?.conversationHistory,
          },
        });

        // Session: 保留 knownFacts + 对话历史供后续对话
        const prevHistory = (prior as any)?.conversationHistory ?? [];
        chatSessionMemory.set(chatKey, {
          priorDigest: prior?.priorDigest,
          knownFacts: prior?.knownFacts ?? [],
          conversationHistory: [
            ...prevHistory,
            { role: "user" as const, content: background },
            { role: "assistant" as const, content: orchResult.messages.join("\n") },
          ].slice(-10),
        } as any);

        // 长期记忆：有草案时自动存快照+embedding
        if (orchResult.draft) {
          savePlanSnapshot(orchResult.traceId, {
            traceId: orchResult.traceId,
            status: "DRAFT_READY",
            draft: orchResult.draft,
            messagePreview: orchResult.messages[0]?.slice(0, 500),
          });
          // 生成 embedding 用于未来相似任务检索
          const summary = `领域:${(orchResult.draft as any)?.classification?.domain ?? "未知"} 子类型:${(orchResult.draft as any)?.classification?.subtype ?? "未知"}`;
          generateQueryEmbedding(summary).then((emb) => {
            if (emb) savePlanEmbedding(orchResult.traceId, summary, emb);
          }).catch(() => {});
        }

        // 模型自己决定输出格式，代码只做兜底
        let outboundMarkdown = orchResult.messages.join("\n\n");
        // 如果模型输出的消息里已经包含表格，不再重复渲染
        if (orchResult.draft && !outboundMarkdown.includes("|")) {
          const tasks = (orchResult.draft as any)?.tasks;
          if (Array.isArray(tasks) && tasks.length > 0) {
            const rows = tasks.map((t: any, i: number) =>
              `| ${i + 1} | ${t.title ?? ""} | ${t.objective ?? ""} | ${(t.deliverables ?? []).join("；") || "-"} | ${(t.completionCriteria ?? []).join("；") || "-"} | ${t.timeNode?.dueAt ?? "待确认"} |`
            );
            outboundMarkdown += "\n\n### 任务列表\n| # | 任务 | 目标 | 交付物 | 完成标准 | 截止日期 |\n|---|---|---|---|---|---|\n" + rows.join("\n");
          }
        }
        if (!outboundMarkdown.trim()) outboundMarkdown = "已收到，正在处理中。";

        // 分配推荐：有草案时同步运行，追加到同一条消息
        if (orchResult.draft && process.env.ASSIGNMENT_PHASE_ENABLED === "1") {
          try {
            const tasksForAssignment = (orchResult.draft as any)?.tasks ?? [];
            const classification = (orchResult.draft as any)?.classification ?? { domain: "QUALITY", subtype: "QUALITY_OTHER_OR_UNCERTAIN" };
            const ar = await runAssignmentRecommendation(
              {
                traceId: orchResult.traceId,
                tasks: tasksForAssignment,
                classificationSummary: `${classification.domain}/${classification.subtype}`,
                domainHint: classification.domain,
              },
              {
                employeeRepo: createEmployeeProfileRepo(resolveEmployeeProfileDir()),
                qwenConfig,
                draftRepo: createAssignmentDraftRepo(resolveAssignmentDraftDir()),
                eventRepo: createAssignmentEventRepo(resolveAssignmentEventsPath()),
              },
            );
            if (ar.ok) {
              const assignments = ar.draft.assignments ?? [];
              if (assignments.length > 0) {
                const rows = assignments.map((a: any) =>
                  `| ${a.taskId ?? ""} | ${a.primary?.displayName ?? "-"} | ${a.confidence ?? "-"} | ${a.primary?.rationale?.slice(0, 60) ?? "-"} |`
                );
                outboundMarkdown += "\n\n### 分配建议\n| 任务 | 推荐负责人 | 置信度 | 理由 |\n|---|---|---|---|\n" + rows.join("\n");
              }
            }
          } catch (err) {
            console.error("[assignment] error:", err instanceof Error ? err.message : String(err));
          }
        }

        dingtalkResponse = await sendMarkdownReply({
          client, sessionWebhook, messageId, senderStaffId,
          title: orchResult.draft ? "任务拆解草案" : "消息",
          markdownText: outboundMarkdown,
        });

      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error("[dingtalk-bot] handler error:", msg);
        try {
          const fallback = JSON.parse(res.data) as Partial<RobotMessage>;
          if (fallback.sessionWebhook && fallback.senderStaffId) {
            dingtalkResponse = await sendMarkdownReply({
              client,
              sessionWebhook: fallback.sessionWebhook,
              messageId,
              senderStaffId: fallback.senderStaffId,
              title: "内部错误",
              markdownText: `处理消息时出错：${msg}`,
            });
          }
        } catch {
          // ignore secondary failure
        }
      } finally {
        ackCallback(client, messageId, dingtalkResponse);
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
