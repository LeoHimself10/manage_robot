import { parseAssistantJsonPayload, type QwenCompatibleClientConfig } from "./demo/qwen-compatible-client";

export type IntentRoute = "TASK_FLOW" | "SMALL_TALK";

export interface IntentRouteInput {
  userMessage: string;
  memorySummary?: string;
  latestDraft?: Record<string, unknown>;
}

export interface IntentRouteResult {
  route: IntentRoute;
  reply: string;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  reason: string;
}

/**
 * Lightweight model router to keep unrelated chat out of heavy task planning flow.
 * This is semantic classification (model-based), not keyword matching.
 */
export async function routeIntentWithModel(
  input: IntentRouteInput,
  config: QwenCompatibleClientConfig,
): Promise<IntentRouteResult> {
  const controller = new AbortController();
  const timeoutMs = Math.max(3000, Math.min(12000, Math.trunc(config.timeoutMs * 0.25)));
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const endpoint = `${config.baseUrl.replace(/\/$/, "")}/chat/completions`;
    const body = {
      model: config.model,
      temperature: 0,
      max_tokens: 220,
      messages: [
        {
          role: "system",
          content: [
            "你是对话路由器。你只做语义判断：当前输入是否应进入“任务规划编排流程”。",
            "返回严格 JSON，字段固定：route, reply, confidence, reason。",
            "route 只能是 TASK_FLOW 或 SMALL_TALK。",
            "判定原则：",
            "1) 若用户是在寒暄、测试连通性、闲聊、无明确任务目标，route=SMALL_TALK。",
            "2) 若用户明确提出任务规划/问题分析/排查/分配等工作请求，route=TASK_FLOW。",
            "3) 若用户明确说继续上个草案/继续上一条，route=TASK_FLOW。",
            "reply 必须给用户可直接发送的话；SMALL_TALK 时简短并引导其描述新任务。",
            "禁止输出 markdown 代码块。",
          ].join("\n"),
        },
        {
          role: "user",
          content: JSON.stringify({
            userMessage: input.userMessage,
            memorySummary: input.memorySummary ?? "",
            hasLatestDraft: input.latestDraft !== undefined,
          }),
        },
      ],
    };

    const resp = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!resp.ok) throw new Error(`intent router api failed: ${resp.status}`);
    const json = (await resp.json()) as {
      choices?: Array<{
        message?: { content?: string };
      }>;
    };
    const raw = String(json.choices?.[0]?.message?.content ?? "").trim();
    const parsed = parseAssistantJsonPayload(raw) as Partial<IntentRouteResult>;

    const route: IntentRoute = parsed.route === "SMALL_TALK" ? "SMALL_TALK" : "TASK_FLOW";
    const confidence =
      parsed.confidence === "HIGH" || parsed.confidence === "MEDIUM" || parsed.confidence === "LOW"
        ? parsed.confidence
        : "MEDIUM";
    const reply = String(parsed.reply ?? "").trim();
    const reason = String(parsed.reason ?? "").trim();

    if (!reply) {
      return route === "SMALL_TALK"
        ? {
            route,
            confidence,
            reason: reason || "router_reply_empty",
            reply: "你好，我在线。你可以直接说一个新的任务背景或问题，我来帮你拆解成可执行草案。",
          }
        : {
            route,
            confidence,
            reason: reason || "router_reply_empty",
            reply: "",
          };
    }

    return { route, reply, confidence, reason };
  } finally {
    clearTimeout(timer);
  }
}

