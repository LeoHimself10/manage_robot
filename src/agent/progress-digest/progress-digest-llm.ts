import { logStructured } from "../../infra/logger";
import type { ProgressDigestFacts } from "./progress-digest-facts";
import { PROGRESS_DIGEST_MARKDOWN_MAX } from "./progress-digest-shared";
import { buildDigestSubject } from "./progress-digest-templates";

export interface ProgressDigestLlmConfig {
  enabled: boolean;
  model: string;
  timeoutMs: number;
  maxTokens: number;
  baseUrl: string;
  apiKey: string;
}

function env(name: string): string {
  return String(process.env[name] ?? "").trim();
}

function envFlag(name: string, defaultValue: boolean): boolean {
  const raw = env(name).toLowerCase();
  if (raw === "") return defaultValue;
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

function envInt(name: string, defaultValue: number): number {
  const n = Number(env(name));
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : defaultValue;
}

export function loadProgressDigestLlmConfig(): ProgressDigestLlmConfig | undefined {
  const apiKey = env("DASHSCOPE_API_KEY") || env("QWEN_API_KEY");
  if (!apiKey) return undefined;
  return {
    enabled: envFlag("PROGRESS_DIGEST_LLM_ENABLED", true),
    model: env("PROGRESS_DIGEST_LLM_MODEL") || "qwen3.6-flash",
    timeoutMs: envInt("PROGRESS_DIGEST_LLM_TIMEOUT_MS", 8000),
    maxTokens: envInt("PROGRESS_DIGEST_LLM_MAX_TOKENS", 800),
    baseUrl: env("QWEN_BASE_URL") || "https://dashscope.aliyuncs.com/compatible-mode/v1",
    apiKey,
  };
}

const SYSTEM_PROMPT = `你是企业内部任务助手，负责把 JSON 事实包改写成钉钉 ActionCard 可读的 Markdown 日报。

规则：
- 只输出一个 JSON 对象：{"subject":"...","markdown":"..."}
- markdown 使用 ### / #### 标题、- 列表、**强调**；禁止 HTML
- 禁止出现 userId、subtaskId、英文 event 名、TASK- 编号开头的行
- 任务标题放前面；编号若出现只能放在括号内
- 必须包含：一句话总结、需您处理（可写暂无）、正常推进（可写暂无）、最近更新（过去 24 小时，可写暂无）
- 总长不超过 3200 字符
- 只使用 JSON 里已有事实，禁止编造`;

function parseLlmJson(raw: string): { subject: string; markdown: string } | null {
  const trimmed = raw.trim();
  const jsonMatch = trimmed.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;
  try {
    const parsed = JSON.parse(jsonMatch[0]) as { subject?: string; markdown?: string };
    const subject = String(parsed.subject ?? "").trim();
    const markdown = String(parsed.markdown ?? "").trim();
    if (!subject || !markdown) return null;
    if (markdown.length > PROGRESS_DIGEST_MARKDOWN_MAX) return null;
    return { subject, markdown };
  } catch {
    return null;
  }
}

export async function summarizeProgressDigestWithLlm(
  facts: ProgressDigestFacts,
  config: ProgressDigestLlmConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<{ subject: string; markdown: string } | null> {
  if (!config.enabled) return null;

  const audienceHint =
    facts.audience === "manager"
      ? "读者是任务主管"
      : facts.audience === "employee"
        ? "读者是任务执行员工"
        : "读者兼主管与员工，请分「我主管的任务」「我负责的任务」两节";

  const userContent = `${audienceHint}。请基于以下 JSON 生成日报：\n${JSON.stringify(facts)}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  const startedAt = Date.now();

  try {
    const endpoint = `${config.baseUrl.replace(/\/$/, "")}/chat/completions`;
    const response = await fetchImpl(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: config.model,
        temperature: 0.3,
        max_tokens: config.maxTokens,
        enable_thinking: false,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userContent },
        ],
      }),
    });

    if (!response.ok) {
      logStructured({
        event: "progress_digest_llm_fallback",
        reason: "http_error",
        status: response.status,
        durationMs: Date.now() - startedAt,
      });
      return null;
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = String(data.choices?.[0]?.message?.content ?? "").trim();
    const parsed = parseLlmJson(content);
    if (!parsed) {
      logStructured({
        event: "progress_digest_llm_fallback",
        reason: "empty",
        durationMs: Date.now() - startedAt,
      });
      return null;
    }

    logStructured({
      event: "progress_digest_llm_ok",
      model: config.model,
      chars: parsed.markdown.length,
      durationMs: Date.now() - startedAt,
    });
    return parsed;
  } catch (err) {
    const reason =
      err instanceof Error && err.name === "AbortError" ? "timeout" : "error";
    logStructured({
      event: "progress_digest_llm_fallback",
      reason,
      error: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - startedAt,
    });
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Subject fallback when LLM returns markdown-only (should not happen with JSON contract). */
export function defaultDigestSubject(facts: ProgressDigestFacts): string {
  return buildDigestSubject(facts);
}
