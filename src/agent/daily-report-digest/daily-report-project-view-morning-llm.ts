import { logStructured } from "../../infra/logger";
import type { OrgDigest } from "./daily-report-build";
import { filterReportContentsWithBody } from "./daily-report-content-filter";
import { countReportAttachments } from "./daily-report-attachments";
import {
  loadDailyReportMorningLlmConfig,
  type DailyReportMorningLlmConfig,
  type DailyReportMorningSummary,
  type PersonBrief,
} from "./daily-report-morning-llm";

export { loadDailyReportMorningLlmConfig };

export interface ProjectViewMorningLlmPayload {
  viewLabel: string;
  rosterCount: number;
  submittedCount: number;
  people: Array<{
    name: string;
    attachmentCount?: number;
    reports: Array<{ template?: string; fields: Array<{ k: string; v: string }> }>;
  }>;
}

function clipLine(raw: string, max: number): string {
  const t = String(raw ?? "").trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

/** 压缩 projectView digest 供 LLM 消费；不含 missing/onLeave。 */
export function slimProjectViewDigestForLlm(
  viewLabel: string,
  rosterCount: number,
  orgDigest: OrgDigest,
): ProjectViewMorningLlmPayload {
  const people: ProjectViewMorningLlmPayload["people"] = [];

  for (const emp of orgDigest.submitted) {
    const attCount = emp.reports.reduce((n, r) => n + countReportAttachments(r), 0);
    const reports = emp.reports
      .map((r) => ({
        template: r.templateName || undefined,
        fields: filterReportContentsWithBody(r.contents)
          .slice(0, 12)
          .map((f) => ({
            k: f.key.slice(0, 40),
            v: f.value.slice(0, 200),
          })),
      }))
      .filter((r) => r.fields.length > 0);

    if (reports.length > 0) {
      people.push({
        name: emp.name,
        ...(attCount > 0 ? { attachmentCount: attCount } : {}),
        reports,
      });
    }
  }

  return {
    viewLabel,
    rosterCount,
    submittedCount: people.length,
    people,
  };
}

const SYSTEM_PROMPT = `你是企业内部项目组早报编辑。根据 JSON 中「统计名单内员工」昨日与指定项目相关的钉钉日报，只输出一个 JSON：
{"overview":"...","personBriefs":[{"name":"...","brief":"..."}],"closing":"..."}

规则：
- overview：2-3 句中文，概括与 viewLabel 相关的整体进展，不超过 180 字
- personBriefs：仅针对 people[] 中有正文的员工，每人一条 brief 不超过 50 字
- closing：1-2 句收束
- submittedCount 为 0 时：overview 与 closing 应自然说明「昨日暂无与该项目相关的日报记录」，并提及 rosterCount（统计名单人数）
- 禁止出现内部术语：命中、filter、roster、成对匹配、模块块
- 禁止在任意字段出现组织标签（如「明思」「微光」）
- 只基于 JSON 事实，禁止编造
- 只输出 JSON，不要 markdown`;

function parseMorningJson(raw: string): DailyReportMorningSummary | null {
  const jsonMatch = raw.trim().match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;
  try {
    const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>;
    const overview = String(parsed.overview ?? "").trim();
    if (!overview) return null;
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
    const closing = clipLine(String(parsed.closing ?? "").trim() || "详见工作台日报汇总。", 120);
    return { overview: clipLine(overview, 200), personBriefs, closing };
  } catch {
    return null;
  }
}

export function fallbackProjectViewMorningSummary(
  viewLabel: string,
  dateLabel: string,
  rosterCount: number,
  orgDigest: OrgDigest,
): DailyReportMorningSummary {
  const meta = slimProjectViewDigestForLlm(viewLabel, rosterCount, orgDigest);
  const personBriefs: PersonBrief[] = meta.people.map((p) => {
    const first = p.reports.flatMap((r) => r.fields).find((f) => f.v.trim())?.v.trim();
    return { name: p.name, brief: clipLine(first ?? "已提交相关日报", 40) };
  });

  if (meta.submittedCount === 0) {
    return {
      overview: `${dateLabel}，统计名单内共 ${rosterCount} 人；昨日暂无与「${viewLabel}」相关的日报记录。`,
      personBriefs: [],
      closing: "可打开工作台查看完整日报汇总。",
    };
  }

  return {
    overview: `${dateLabel}，统计名单内 ${rosterCount} 人，昨日有 ${meta.submittedCount} 人提交了与「${viewLabel}」相关的日报。`,
    personBriefs: personBriefs.slice(0, 8),
    closing: "整体推进详见个人简述与工作台日报汇总。",
  };
}

export async function summarizeProjectViewMorningWithLlm(
  viewLabel: string,
  dateLabel: string,
  rosterCount: number,
  orgDigest: OrgDigest,
  config: DailyReportMorningLlmConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<DailyReportMorningSummary> {
  if (!config.enabled) {
    return fallbackProjectViewMorningSummary(viewLabel, dateLabel, rosterCount, orgDigest);
  }

  const llmPayload = slimProjectViewDigestForLlm(viewLabel, rosterCount, orgDigest);
  const userContent = `日期：${dateLabel}。请生成项目组早报综述 JSON：\n${JSON.stringify(llmPayload)}`;
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
        event: "daily_report_project_view_digest_llm_fallback",
        reason: "http_error",
        status: response.status,
        durationMs: Date.now() - startedAt,
      });
      return fallbackProjectViewMorningSummary(viewLabel, dateLabel, rosterCount, orgDigest);
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = String(data.choices?.[0]?.message?.content ?? "").trim();
    const parsed = parseMorningJson(content);
    if (!parsed) {
      logStructured({
        event: "daily_report_project_view_digest_llm_fallback",
        reason: "parse_error",
        durationMs: Date.now() - startedAt,
      });
      return fallbackProjectViewMorningSummary(viewLabel, dateLabel, rosterCount, orgDigest);
    }

    logStructured({
      event: "daily_report_project_view_digest_llm_ok",
      model: config.model,
      personBriefCount: parsed.personBriefs.length,
      durationMs: Date.now() - startedAt,
    });
    return parsed;
  } catch (err) {
    logStructured({
      event: "daily_report_project_view_digest_llm_fallback",
      reason: err instanceof Error && err.name === "AbortError" ? "timeout" : "error",
      error: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - startedAt,
    });
    return fallbackProjectViewMorningSummary(viewLabel, dateLabel, rosterCount, orgDigest);
  } finally {
    clearTimeout(timer);
  }
}
