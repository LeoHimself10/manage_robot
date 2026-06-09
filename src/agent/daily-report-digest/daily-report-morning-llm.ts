import { logStructured } from "../../infra/logger";
import type { OrgDigest } from "./daily-report-build";

export interface DailyReportMorningLlmConfig {
  enabled: boolean;
  model: string;
  timeoutMs: number;
  maxTokens: number;
  baseUrl: string;
  apiKey: string;
}

export interface DailyReportMorningSummary {
  headline: string;
  highlights: string[];
  attention?: string;
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

export function loadDailyReportMorningLlmConfig(): DailyReportMorningLlmConfig | undefined {
  const apiKey = env("DASHSCOPE_API_KEY") || env("QWEN_API_KEY");
  if (!apiKey) return undefined;
  return {
    enabled: envFlag("DAILY_REPORT_MORNING_LLM_ENABLED", true),
    model: env("DAILY_REPORT_MORNING_LLM_MODEL") || "qwen3.6-flash",
    timeoutMs: envInt("DAILY_REPORT_MORNING_LLM_TIMEOUT_MS", 12000),
    maxTokens: envInt("DAILY_REPORT_MORNING_LLM_MAX_TOKENS", 900),
    baseUrl: env("QWEN_BASE_URL") || "https://dashscope.aliyuncs.com/compatible-mode/v1",
    apiKey,
  };
}

/** 压缩 orgDigests 供 LLM 消费，避免超长。 */
export function slimOrgDigestsForLlm(orgDigests: OrgDigest[]): Record<string, unknown> {
  return {
    orgs: orgDigests.map((org) => ({
      label: org.label,
      submitted: org.submitted.map((emp) => ({
        name: emp.name,
        reports: emp.reports.map((r) => ({
          template: r.templateName,
          fields: r.contents.slice(0, 12).map((f) => ({
            k: f.key.slice(0, 40),
            v: f.value.slice(0, 200),
          })),
        })),
      })),
      missing: org.missing.map((m) => m.name),
      errors: org.errors.map((e) => e.name),
    })),
  };
}

const SYSTEM_PROMPT = `你是企业内部早报编辑。根据 JSON 中各组织员工的昨日钉钉日报，只输出一个 JSON：
{"headline":"...","highlights":["..."],"attention":"..."}

规则：
- headline：2-3 句中文综述，概括整体进展与重点，不超过 180 字
- highlights：3-6 条要点，每条不超过 50 字，按重要性排序
- attention：可选，1 句点出需关注事项（未交、阻塞、风险）；无则空字符串
- 只基于 JSON 事实，禁止编造
- 只输出 JSON，不要 markdown`;

function clipLine(raw: string, max: number): string {
  const t = String(raw ?? "").trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

function parseMorningJson(raw: string): DailyReportMorningSummary | null {
  const jsonMatch = raw.trim().match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;
  try {
    const parsed = JSON.parse(jsonMatch[0]) as {
      headline?: string;
      highlights?: unknown;
      attention?: string;
    };
    const headline = String(parsed.headline ?? "").trim();
    if (!headline) return null;
    const highlights = Array.isArray(parsed.highlights)
      ? parsed.highlights.map((h) => clipLine(String(h ?? ""), 50)).filter(Boolean).slice(0, 6)
      : [];
    const attention = String(parsed.attention ?? "").trim();
    return { headline, highlights, attention: attention || undefined };
  } catch {
    return null;
  }
}

export function fallbackMorningSummary(
  orgDigests: OrgDigest[],
  dateLabel: string,
): DailyReportMorningSummary {
  let submitted = 0;
  let missing = 0;
  const names: string[] = [];
  for (const org of orgDigests) {
    submitted += org.submitted.length;
    missing += org.missing.length;
    for (const m of org.missing) names.push(m.name);
  }
  const headline = `${dateLabel} 共 ${submitted} 人已交日报${missing ? `，${missing} 人未交` : ""}。`;
  const highlights: string[] = [];
  for (const org of orgDigests) {
    for (const emp of org.submitted.slice(0, 4)) {
      const first = emp.reports[0]?.contents.find((f) => f.value.trim())?.value.trim();
      if (first) highlights.push(`${org.label}·${emp.name}：${clipLine(first, 40)}`);
    }
  }
  return {
    headline,
    highlights: highlights.slice(0, 5),
    attention: names.length ? `未提交：${names.join("、")}` : undefined,
  };
}

export async function summarizeMorningReportsWithLlm(
  orgDigests: OrgDigest[],
  dateLabel: string,
  config: DailyReportMorningLlmConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<DailyReportMorningSummary> {
  if (!config.enabled) return fallbackMorningSummary(orgDigests, dateLabel);

  const userContent = `日期：${dateLabel}。请生成早报综述 JSON：\n${JSON.stringify(slimOrgDigestsForLlm(orgDigests))}`;
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
        event: "daily_report_morning_llm_fallback",
        reason: "http_error",
        status: response.status,
        durationMs: Date.now() - startedAt,
      });
      return fallbackMorningSummary(orgDigests, dateLabel);
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = String(data.choices?.[0]?.message?.content ?? "").trim();
    const parsed = parseMorningJson(content);
    if (!parsed) {
      logStructured({
        event: "daily_report_morning_llm_fallback",
        reason: "parse_error",
        durationMs: Date.now() - startedAt,
      });
      return fallbackMorningSummary(orgDigests, dateLabel);
    }

    logStructured({
      event: "daily_report_morning_llm_ok",
      model: config.model,
      highlightCount: parsed.highlights.length,
      durationMs: Date.now() - startedAt,
    });
    return parsed;
  } catch (err) {
    logStructured({
      event: "daily_report_morning_llm_fallback",
      reason: err instanceof Error && err.name === "AbortError" ? "timeout" : "error",
      error: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - startedAt,
    });
    return fallbackMorningSummary(orgDigests, dateLabel);
  } finally {
    clearTimeout(timer);
  }
}
