import { logStructured } from "../../infra/logger";
import type { OrgDigest } from "./daily-report-build";
import { filterReportContentsWithBody } from "./daily-report-content-filter";
import { countReportAttachments } from "./daily-report-attachments";

export interface DailyReportMorningLlmConfig {
  enabled: boolean;
  model: string;
  timeoutMs: number;
  maxTokens: number;
  baseUrl: string;
  apiKey: string;
}

export interface PersonBrief {
  name: string;
  brief: string;
}

export interface DailyReportMorningSummary {
  overview: string;
  personBriefs: PersonBrief[];
  closing: string;
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
    maxTokens: envInt("DAILY_REPORT_MORNING_LLM_MAX_TOKENS", 1200),
    baseUrl: env("QWEN_BASE_URL") || "https://dashscope.aliyuncs.com/compatible-mode/v1",
    apiKey,
  };
}

/** 压缩 orgDigests 供 LLM 消费，扁平化为 people[]，不传组织名。 */
export function slimOrgDigestsForLlm(orgDigests: OrgDigest[]): Record<string, unknown> {
  const people: Array<{
    name: string;
    attachmentCount?: number;
    reports: Array<{ template?: string; fields: Array<{ k: string; v: string }> }>;
  }> = [];
  const missing: string[] = [];

  for (const org of orgDigests) {
    for (const emp of org.submitted) {
      const attCount = emp.reports.reduce((n, r) => n + countReportAttachments(r), 0);
      people.push({
        name: emp.name,
        ...(attCount > 0 ? { attachmentCount: attCount } : {}),
        reports: emp.reports
          .map((r) => ({
            template: r.templateName || undefined,
            fields: filterReportContentsWithBody(r.contents)
              .slice(0, 12)
              .map((f) => ({
                k: f.key.slice(0, 40),
                v: f.value.slice(0, 200),
              })),
          }))
          .filter((r) => r.fields.length > 0),
      });
    }
    for (const m of org.missing) missing.push(m.name);
  }

  return { people, missing };
}

const SYSTEM_PROMPT = `你是企业内部早报编辑。根据 JSON 中员工的昨日钉钉日报，只输出一个 JSON：
{"overview":"...","personBriefs":[{"name":"...","brief":"..."}],"closing":"..."}

规则：
- overview：2-3 句中文，概括整体进展，不超过 180 字
- personBriefs：每位已交员工一条，brief 不超过 50 字，按重要性排序；只写姓名，禁止出现组织/部门/公司名
- closing：1-2 句收束；未交、阻塞、风险写在这里；若 people[].attachmentCount>0 可写「部分日报含附件，详见工作台日报汇总/钉钉原文」
- 禁止在任意字段出现「明思」「微光」等组织标签
- 只基于 JSON 事实，禁止编造
- 只输出 JSON，不要 markdown`;

function clipLine(raw: string, max: number): string {
  const t = String(raw ?? "").trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

function mapLegacySummary(parsed: Record<string, unknown>): DailyReportMorningSummary | null {
  const headline = String(parsed.headline ?? "").trim();
  if (!headline) return null;
  const highlights = Array.isArray(parsed.highlights)
    ? parsed.highlights.map((h) => clipLine(String(h ?? ""), 50)).filter(Boolean)
    : [];
  const attention = String(parsed.attention ?? "").trim();
  const personBriefs: PersonBrief[] = highlights.map((h) => {
    const sep = h.indexOf("：");
    if (sep > 0) {
      return { name: h.slice(0, sep).replace(/^[^·]+·/, ""), brief: h.slice(sep + 1) };
    }
    return { name: "要点", brief: h };
  });
  return {
    overview: headline,
    personBriefs,
    closing: attention || "请继续保持日报节奏。",
  };
}

function parseMorningJson(raw: string): DailyReportMorningSummary | null {
  const jsonMatch = raw.trim().match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;
  try {
    const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>;
    const overview = String(parsed.overview ?? "").trim();
    if (overview) {
      const personBriefs = Array.isArray(parsed.personBriefs)
        ? parsed.personBriefs
            .map((p) => {
              const o = (p ?? {}) as { name?: string; brief?: string };
              return {
                name: String(o.name ?? "").trim(),
                brief: clipLine(String(o.brief ?? ""), 50),
              };
            })
            .filter((p) => p.name && p.brief)
            .slice(0, 12)
        : [];
      const closing = String(parsed.closing ?? "").trim() || "请继续保持日报节奏。";
      return { overview: clipLine(overview, 200), personBriefs, closing: clipLine(closing, 120) };
    }
    return mapLegacySummary(parsed);
  } catch {
    return null;
  }
}

export function fallbackMorningSummary(
  orgDigests: OrgDigest[],
  dateLabel: string,
): DailyReportMorningSummary {
  let submitted = 0;
  const missingNames: string[] = [];
  const personBriefs: PersonBrief[] = [];

  for (const org of orgDigests) {
    submitted += org.submitted.length;
    for (const m of org.missing) missingNames.push(m.name);
    for (const emp of org.submitted) {
      const first = emp.reports
        .flatMap((r) => filterReportContentsWithBody(r.contents))
        .find((f) => f.value.trim())?.value.trim();
      if (first) {
        personBriefs.push({ name: emp.name, brief: clipLine(first, 40) });
      }
    }
  }

  const overview = `${dateLabel} 共 ${submitted} 人已交日报${missingNames.length ? `，${missingNames.length} 人未交` : ""}。`;
  const closing = missingNames.length
    ? `未提交：${missingNames.join("、")}。`
    : "整体推进正常，请继续保持。";

  return {
    overview,
    personBriefs: personBriefs.slice(0, 8),
    closing,
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
      personBriefCount: parsed.personBriefs.length,
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
