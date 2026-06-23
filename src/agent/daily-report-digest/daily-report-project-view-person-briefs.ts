import type { OrgDigest } from "./daily-report-build";
import type { PersonBrief } from "./daily-report-morning-llm";
import {
  fallbackProjectViewMorningSummary,
  loadDailyReportMorningLlmConfig,
  summarizeProjectViewMorningWithLlm,
} from "./daily-report-project-view-morning-llm";
import {
  getProjectViewCache,
  putProjectViewCache,
  type ProjectViewCachePayload,
  type ProjectViewCacheStore,
} from "./daily-report-project-view-cache";

export function personBriefsToMap(briefs: PersonBrief[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const p of briefs) {
    const name = p.name.trim();
    const brief = p.brief.trim();
    if (name && brief) map.set(name, brief);
  }
  return map;
}

export function resolvePersonBriefForEmployee(
  name: string,
  userid: string,
  briefByName: Map<string, string>,
): string | undefined {
  const n = name.trim();
  if (n && briefByName.has(n)) return briefByName.get(n);
  const uid = userid.trim();
  if (uid && briefByName.has(uid)) return briefByName.get(uid);
  return undefined;
}

/** 工作台项目详情：加载/缓存 LLM 逐人简述（与单项目早报同源）。 */
export async function ensureProjectViewPersonBriefs(input: {
  viewId: string;
  viewLabel: string;
  dateYmd: string;
  dateLabel: string;
  rosterCount: number;
  orgDigest: OrgDigest;
  cacheStore: ProjectViewCacheStore;
  fetchImpl?: typeof fetch;
  refresh?: boolean;
}): Promise<PersonBrief[]> {
  if (input.orgDigest.submitted.length === 0) return [];

  if (!input.refresh) {
    const cached = getProjectViewCache(input.viewId, input.dateYmd, input.cacheStore);
    if (cached?.payload.personBriefs?.length) {
      return cached.payload.personBriefs;
    }
  }

  const llmConfig = loadDailyReportMorningLlmConfig();
  let briefs: PersonBrief[];
  if (llmConfig?.enabled) {
    const summary = await summarizeProjectViewMorningWithLlm(
      input.viewLabel,
      input.dateLabel,
      input.rosterCount,
      input.orgDigest,
      llmConfig,
      input.fetchImpl,
    );
    briefs = summary.personBriefs;
  } else {
    briefs = fallbackProjectViewMorningSummary(
      input.viewLabel,
      input.dateLabel,
      input.rosterCount,
      input.orgDigest,
    ).personBriefs;
  }

  const cached = getProjectViewCache(input.viewId, input.dateYmd, input.cacheStore);
  if (cached) {
    const next: ProjectViewCachePayload = {
      ...cached.payload,
      personBriefs: briefs,
      personBriefsGeneratedAt: new Date().toISOString(),
    };
    putProjectViewCache(input.viewId, input.dateYmd, next, input.cacheStore);
  }

  return briefs;
}
