import "dotenv/config";

import http from "node:http";

import {
  DWClient,
  EventAck,
  TOPIC_ROBOT,
  type DWClientDownStream,
  type RobotMessage,
} from "dingtalk-stream";

import type { PlanDomain } from "./agent/harness/types";
import {
  createTaskPlanningDemo,
  type TaskPlanningDemoResult,
} from "./agent/demo/pipeline";
import { loadQwenPlannerConfigFromEnv, runQwenPlanner } from "./agent/demo/qwen-planner";
import {
  deriveChatSessionKey,
  MemoryChatSessionStore,
  readRateLimitWindowMs,
} from "./infra/session-store";
import {
  readDemoLlmCorrectionEnabled,
  readSessionDigestMaxChars,
} from "./infra/demo-runtime-env";
import { summarizePriorDemoForPrompt } from "./infra/session-digest";
import { formatNeedsMoreInfoDingTalkMarkdown } from "./dingtalk-needs-more-info-markdown";

/** 钉钉 markdown 单条上限约 2 万字符，预留余量避免被拒收 */
const MAX_MARKDOWN_CHARS = 18_000;

function parseDomainHint(raw: string | undefined): PlanDomain | undefined {
  if (!raw?.trim()) return undefined;
  const u = raw.trim().toUpperCase();
  if (u === "QUALITY" || u === "RD") return u;
  return undefined;
}

function truncateMarkdown(body: string): string {
  if (body.length <= MAX_MARKDOWN_CHARS) return body;
  return `${body.slice(0, MAX_MARKDOWN_CHARS)}\n\n_(内容过长已截断)_`;
}

function formatDemoReply(result: TaskPlanningDemoResult): {
  title: string;
  markdownText: string;
} {
  if (result.status === "NEEDS_MORE_INFO") {
    const markdownText = formatNeedsMoreInfoDingTalkMarkdown(result.questions);
    return { title: "待补充信息", markdownText };
  }
  if (result.status === "GENERATION_FAILED") {
    const lines = [
      `**生成失败：** ${result.reason}`,
      "",
      "---",
      "",
      "**建议：**",
      ...result.recoverySuggestions.map((s) => `- ${s}`),
    ];
    if (result.trace?.errorCode) lines.push("", `_errorCode=${result.trace.errorCode}_`);
    return { title: "生成失败", markdownText: lines.join("\n") };
  }
  return {
    title: "任务拆解草案",
    markdownText: truncateMarkdown(result.markdown),
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
  return data;
}

function ackCallback(client: DWClient, messageId: string, dingtalkResponse: unknown): void {
  client.socketCallBackResponse(messageId, dingtalkResponse);
}

function startHealthServer(port: number): void {
  const server = http.createServer((req, res) => {
    if (req.url === "/health" || req.url === "/") {
      res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("ok");
      return;
    }
    res.writeHead(404);
    res.end();
  });
  server.listen(port, () => {
    console.info(`[health] listening on :${port} (/health)`);
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

  const domainHint = parseDomainHint(process.env.DEMO_DOMAIN_HINT);
  const enableLlmCorrection = readDemoLlmCorrectionEnabled();
  const sessionDigestMaxChars = readSessionDigestMaxChars();
  const debug = process.env.DINGTALK_STREAM_DEBUG === "1" || process.env.DINGTALK_STREAM_DEBUG === "true";

  const healthPort = Number(process.env.HEALTH_CHECK_PORT ?? "");
  if (Number.isFinite(healthPort) && healthPort > 0) {
    startHealthServer(healthPort);
  }

  const client = new DWClient({
    clientId,
    clientSecret,
    debug,
  });

  const chatSessionMemory = new MemoryChatSessionStore<{ priorDigest?: string }>();

  client.registerCallbackListener(TOPIC_ROBOT, (res: DWClientDownStream) => {
    void (async () => {
      const messageId = res.headers.messageId;
      let dingtalkResponse: unknown = { errcode: 0, errmsg: "ok" };

      try {
        const payload = JSON.parse(res.data) as RobotMessage;
        if (payload.msgtype !== "text" || !payload.text?.content?.trim()) {
          dingtalkResponse = await sendMarkdownReply({
            client,
            sessionWebhook: payload.sessionWebhook,
            messageId,
            senderStaffId: payload.senderStaffId,
            title: "提示",
            markdownText: "当前仅支持 **文本** 消息，请直接发送任务背景描述。",
          });
          return;
        }

        const background = payload.text.content.trim();
        const chatKey = deriveChatSessionKey({
          sessionWebhook: payload.sessionWebhook,
          senderStaffId: payload.senderStaffId,
        });

        if (!chatSessionMemory.checkRateLimitThenTouch(chatKey, readRateLimitWindowMs())) {
          dingtalkResponse = await sendMarkdownReply({
            client,
            sessionWebhook: payload.sessionWebhook,
            messageId,
            senderStaffId: payload.senderStaffId,
            title: "请稍后再试",
            markdownText:
              "**请求过于频繁。** 同一会话在短时间内仅处理一条任务规划，请稍后再发，避免重复消耗模型配额。",
          });
          return;
        }

        const prior = chatSessionMemory.get(chatKey);
        const demoResult = await createTaskPlanningDemo(
          {
            domainHint,
            background,
            sessionDigest: prior?.priorDigest,
          },
          {
            llmPlanner: (request) => runQwenPlanner(request, qwenConfig),
            enableLlmCorrection,
          }
        );

        const nextDigest =
          summarizePriorDemoForPrompt(demoResult, sessionDigestMaxChars) ??
          prior?.priorDigest;
        chatSessionMemory.set(chatKey, {
          priorDigest: nextDigest,
        });

        const { title, markdownText } = formatDemoReply(demoResult);
        dingtalkResponse = await sendMarkdownReply({
          client,
          sessionWebhook: payload.sessionWebhook,
          messageId,
          senderStaffId: payload.senderStaffId,
          title,
          markdownText,
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

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
