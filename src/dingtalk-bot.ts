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
import {
  resolveEmployeeProfileDir,
  resolveAssignmentDraftDir,
  resolveAssignmentEventsPath,
  resolveAssignmentWebPublicBaseUrl,
  isDingtalkAssignmentMock,
} from "./infra/assignment-env";
import { createEmployeeProfileRepo } from "./integrations/repos/employee-profile-repo";
import { createAssignmentDraftRepo } from "./integrations/repos/assignment-draft-repo";
import { createAssignmentEventRepo } from "./integrations/repos/assignment-event-repo";
import { runAssignmentRecommendation } from "./agent/assignment/run-assignment-recommendation";
import { signAssignmentEntry } from "./security/web-entry-token";
import { handleAssignmentHttp } from "./web/assignment-workbench";
import {
  buildAssignmentFollowUpMarkdown,
} from "./dingtalk/assignment-markdown-appendix";
import { mockManagerCard } from "./integrations/dingtalk/assignment-card-mock";
import { isTaskInitiatorAllowed } from "./security/initiator-whitelist";
import { runOrchestrator } from "./agent/orchestrator";
import { getSessionKnownFacts, updateSessionKnownFacts } from "./dingtalk-session-context";
import { renderPlanDraftMarkdown } from "./agent/demo/markdown-renderer";

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

  const sessionDigestMaxChars = readSessionDigestMaxChars();
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
          sessionContext: { knownFacts: getSessionKnownFacts(prior) },
        });

        // Session: 保留 knownFacts 供后续对话
        chatSessionMemory.set(chatKey, {
          priorDigest: prior?.priorDigest,
          knownFacts: prior?.knownFacts ?? [],
        } as any);

        // 构建输出：message + 可选表格草案
        let outboundMarkdown = orchResult.messages.join("\n\n");
        if (orchResult.draft) {
          const markdown = renderPlanDraftMarkdown({
            summary: background.slice(0, 120),
            classification: (orchResult.draft as any).classification ?? { domain: "QUALITY", subtype: "QUALITY_OTHER_OR_UNCERTAIN", confidence: "MEDIUM", rationale: [], missingInformation: [] },
            capaAdvisory: (orchResult.draft as any).capaAdvisory,
            tasks: (orchResult.draft as any).tasks ?? [],
            gate: (orchResult.draft as any).gateSelfCheck ?? { passed: true, missingByTask: [] },
            openQuestions: (orchResult.draft as any).openQuestions ?? [],
          });
          outboundMarkdown += "\n\n" + markdown;
        }
        if (!outboundMarkdown.trim()) outboundMarkdown = orchResult.messages.join("\n\n") || "已收到，正在处理中。";

        if (outboundMarkdown.length > MAX_MARKDOWN_CHARS) {
          outboundMarkdown = outboundMarkdown.slice(0, MAX_MARKDOWN_CHARS) + "\n\n_(内容过长已截断)_";
        }

        dingtalkResponse = await sendMarkdownReply({
          client, sessionWebhook, messageId, senderStaffId,
          title: orchResult.draft ? "任务拆解草案" : "消息",
          markdownText: outboundMarkdown,
        });

        // Async: assignment phase (fire-and-forget)
        if (
          orchResult.draft &&
          isTaskInitiatorAllowed(payload.senderStaffId) &&
          process.env.ASSIGNMENT_PHASE_ENABLED === "1"
        ) {
          void (async () => {
            try {
              const draft = orchResult.draft!;
              const tasksFromDraft = (draft as any)?.tasks ?? [];
              const classFromDraft = (draft as any)?.classification ?? {
                domain: "QUALITY",
                subtype: "QUALITY_OTHER_OR_UNCERTAIN",
              };
              const ar = await runAssignmentRecommendation(
                {
                  traceId: orchResult.traceId,
                  tasks: tasksFromDraft,
                  classificationSummary: `${classFromDraft.domain}/${classFromDraft.subtype}`,
                  domainHint: classFromDraft.domain,
                },
                {
                  employeeRepo: createEmployeeProfileRepo(resolveEmployeeProfileDir()),
                  qwenConfig,
                  draftRepo: createAssignmentDraftRepo(resolveAssignmentDraftDir()),
                  eventRepo: createAssignmentEventRepo(resolveAssignmentEventsPath()),
                },
              );

              if (!ar.ok) {
                console.error("[assignment] generation failed:", ar.reason);
                return;
              }

              const baseUrl = resolveAssignmentWebPublicBaseUrl();
              const signed = signAssignmentEntry({
                planId: orchResult.traceId,
                userId: senderStaffId,
                role: "manager",
                ttlSeconds: 1800,
              });

              const followUpMarkdown = buildAssignmentFollowUpMarkdown({
                baseUrl,
                token: signed.token,
                draft: ar.draft,
              });

              await sendMarkdownReply({
                client,
                sessionWebhook,
                messageId,
                senderStaffId,
                title: "分配建议",
                markdownText: followUpMarkdown,
              });

              if (isDingtalkAssignmentMock()) {
                mockManagerCard({ traceId: orchResult.traceId, outTrackId: `assign:${orchResult.traceId}` });
              }

              // Update session state
              const updated = chatSessionMemory.get(chatKey);
              if (updated) {
                chatSessionMemory.set(chatKey, {
                  ...updated,
                  assignmentState: { stage: "AWAITING_DISPATCH_CONFIRM", lastAssignmentTraceId: orchResult.traceId },
                });
              }
            } catch (err) {
              console.error("[assignment] background error:", err instanceof Error ? err.message : err);
            }
          })();
        }
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
