/**
 * Lightweight LLM intent classifier for v2 tool_choice gate (fail-open).
 * Uses qwen-doc-turbo (or INTENT_CLASSIFIER_MODEL) for semantic routing when
 * regex cannot cover multilingual / paraphrased user messages.
 */
import { logStructured } from "../../infra/logger";

export type RowSplitIntent = "split" | "other";

export interface IntentClassifierConfig {
  apiKey: string;
  baseUrl: string;
  model?: string;
  timeoutMs?: number;
}

function readClassifierModel(): string {
  return String(process.env.INTENT_CLASSIFIER_MODEL ?? "qwen-doc-turbo").trim();
}

function readClassifierTimeoutMs(fallback = 3000): number {
  const raw = Number(process.env.INTENT_CLASSIFIER_TIMEOUT_MS ?? fallback);
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
}

function parseIntentJson(raw: string): RowSplitIntent {
  const normalized = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim() ?? raw.trim();
  const parsed = JSON.parse(normalized) as { intent?: unknown };
  return parsed.intent === "split" ? "split" : "other";
}

const ROW_SPLIT_SYSTEM_PROMPT = [
  "只回答 JSON：{\"intent\":\"split\"} 或 {\"intent\":\"other\"}，不要解释。",
  "split = 用户要把草案/任务表中的【某一条】子任务拆成两条或多条更细的工作包（局部拆分，不是整表重出）。",
  "other = 其他所有意图（整表重拆、修改单行字段、指派、发布、澄清、查询等）。",
].join("\n");

/**
 * Classify whether the user wants to split a single draft subtask into finer
 * work packages. Fail-open → "other" on missing config, timeout, or parse error.
 */
export async function classifyRowSplitIntent(
  userMessage: string,
  config?: IntentClassifierConfig,
): Promise<RowSplitIntent> {
  const text = String(userMessage ?? "").trim();
  if (!text) return "other";
  if (!config?.apiKey?.trim() || !config.baseUrl?.trim()) {
    return "other";
  }

  const model = config.model?.trim() || readClassifierModel();
  const timeoutMs = config.timeoutMs ?? readClassifierTimeoutMs();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const resp = await fetch(`${config.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        temperature: 0,
        max_tokens: 32,
        messages: [
          { role: "system", content: ROW_SPLIT_SYSTEM_PROMPT },
          { role: "user", content: text },
        ],
      }),
    });
    if (!resp.ok) {
      logStructured({
        event: "intent_classifier_error",
        status: resp.status,
        model,
      });
      return "other";
    }
    const json = (await resp.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const raw = String(json.choices?.[0]?.message?.content ?? "").trim();
    if (!raw) return "other";
    const intent = parseIntentJson(raw);
    logStructured({
      event: "intent_classifier_result",
      intent,
      model,
      messageChars: text.length,
    });
    return intent;
  } catch (err) {
    logStructured({
      event: "intent_classifier_error",
      error: err instanceof Error ? err.message : String(err),
      model,
    });
    return "other";
  } finally {
    clearTimeout(timer);
  }
}
