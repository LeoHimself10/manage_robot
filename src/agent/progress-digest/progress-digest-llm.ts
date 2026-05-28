import { logStructured } from "../../infra/logger";
import type { ProgressDigestFacts, ProgressDigestFactsCore } from "./progress-digest-facts";
import { buildDigestSubject, renderHeadline } from "./progress-digest-templates";

export interface ProgressDigestLlmConfig {
  enabled: boolean;
  model: string;
  timeoutMs: number;
  maxTokens: number;
  baseUrl: string;
  apiKey: string;
}

export interface ProgressDigestLlmSummary {
  headline: string;
  suggestions: string[];
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

function slimCore(core: ProgressDigestFactsCore) {
  return {
    summary: core.summary,
    needsAttention: core.needsAttention.slice(0, 8).map((item) => ({
      taskTitle: item.taskTitle,
      subtaskTitle: item.subtaskTitle,
      assigneeNames: item.assigneeNames,
      statusLabel: item.statusLabel,
      dueLabel: item.dueLabel,
      reasonHint: item.reasonHint,
      overdue: item.overdue,
    })),
    inProgressCount: core.inProgress.length,
    recentUpdateCount: core.recentUpdates.length,
  };
}

export function slimFactsForLlm(facts: ProgressDigestFacts): Record<string, unknown> {
  return {
    dateDisplay: facts.dateDisplay,
    audience: facts.audience,
    activityWindow: facts.activityWindow,
    core: slimCore(facts.core),
    managerCore: facts.managerCore ? slimCore(facts.managerCore) : undefined,
    employeeCore: facts.employeeCore ? slimCore(facts.employeeCore) : undefined,
  };
}

const SYSTEM_PROMPT = `你是企业内部任务助手。根据 JSON 事实包，只输出一个 JSON 对象：
{"headline":"...","suggestions":["..."]}

规则：
- headline：1-2 句中文概览，不超过 120 字
- suggestions：1-3 条后续工作建议，每条不超过 40 字；须能从 JSON 推出（逾期跟进、待承接、阻塞协调等）
- 禁止编造 JSON 中不存在的任务/人员
- 禁止出现 userId、subtaskId、TASK- 编号
- 只输出 JSON，不要 markdown 表格`;

function clipSuggestion(raw: string): string {
  const t = String(raw ?? "").trim();
  if (t.length <= 40) return t;
  return `${t.slice(0, 39)}…`;
}

function parseLlmJson(raw: string): ProgressDigestLlmSummary | null {
  const trimmed = raw.trim();
  const jsonMatch = trimmed.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;
  try {
    const parsed = JSON.parse(jsonMatch[0]) as { headline?: string; suggestions?: unknown };
    const headline = String(parsed.headline ?? "").trim();
    if (!headline) return null;
    const suggestions = Array.isArray(parsed.suggestions)
      ? parsed.suggestions
          .map((s) => clipSuggestion(String(s ?? "")))
          .filter(Boolean)
          .slice(0, 3)
      : [];
    return { headline, suggestions };
  } catch {
    return null;
  }
}

export async function summarizeProgressDigestWithLlm(
  facts: ProgressDigestFacts,
  config: ProgressDigestLlmConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<ProgressDigestLlmSummary | null> {
  if (!config.enabled) return null;

  const audienceHint =
    facts.audience === "manager"
      ? "读者是任务主管"
      : facts.audience === "employee"
        ? "读者是任务执行员工"
        : "读者兼主管与员工";

  const userContent = `${audienceHint}。请基于以下 JSON 生成 headline 与 suggestions：\n${JSON.stringify(slimFactsForLlm(facts))}`;

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
      suggestionCount: parsed.suggestions.length,
      durationMs: Date.now() - startedAt,
    });
    return parsed;
  } catch (err) {
    const reason = err instanceof Error && err.name === "AbortError" ? "timeout" : "error";
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

export function defaultDigestHeadline(facts: ProgressDigestFacts): string {
  if (facts.audience === "combined" && facts.managerCore && facts.employeeCore) {
    return `${renderHeadline(facts.managerCore, "manager")} ${renderHeadline(facts.employeeCore, "employee")}`.trim();
  }
  const role = facts.audience === "employee" ? "employee" : "manager";
  return renderHeadline(facts.core, role);
}

export function defaultDigestSubject(facts: ProgressDigestFacts): string {
  return buildDigestSubject(facts);
}
