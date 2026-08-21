import type { ReportContentField, ReportEntry } from "./dingtalk-report-client";
import {
  parseAttachmentsFromValue,
  parseReportImages,
  type ReportAttachment,
} from "./daily-report-attachments";

const MODULE_INDICES = ["①", "②", "③", "④", "⑤", "⑥"] as const;

export interface ProductLineProbeKeyword {
  id: string;
  label: string;
  /** 子串匹配（中文全名或英文缩写） */
  needle: string;
}

export const DEFAULT_PRODUCT_LINE_KEYWORDS: ProductLineProbeKeyword[] = [
  { id: "cla", label: "CLA 项目", needle: "CLA" },
  { id: "oct", label: "OCT 项目", needle: "OCT" },
  { id: "laser-shockwave", label: "激光冲击波 项目", needle: "激光冲击波" },
  { id: "large-vessel-plaque", label: "大血管斑块减容 项目", needle: "大血管斑块减容" },
];

export type ProbeFieldKind = "workModule" | "costProject" | "other";

export interface ProbeFieldHit {
  key: string;
  value: string;
  kind: ProbeFieldKind;
  moduleIndex?: string;
}

export interface ProbeReportSample {
  reportId?: string;
  creatorUserId: string;
  creatorName: string;
  createTime: number;
  templateName: string;
  hits: ProbeFieldHit[];
  imageCount: number;
  attachmentCount: number;
  attachmentSample?: ReportAttachment;
}

export interface ProbeKeywordStats {
  id: string;
  label: string;
  needle: string;
  hitReportCount: number;
  hitUserCount: number;
  userids: string[];
  fieldKindCounts: Record<ProbeFieldKind, number>;
  moduleIndexCounts: Record<string, number>;
  workModuleValueSamples: string[];
  costProjectValueSamples: string[];
  reportSamples: ProbeReportSample[];
  suggestedFilter?: {
    workModuleContains: string;
    costProjectContains: string;
    confidence: "high" | "medium" | "low";
    notes: string[];
  };
}

export interface ProductLineProbeResult {
  scannedContactCount: number;
  scannedReportCount: number;
  keywords: ProbeKeywordStats[];
  generatedAt: string;
}

function classifyFieldKind(key: string): ProbeFieldKind {
  if (key.includes("工作模块")) return "workModule";
  if (key.includes("成本归属项目")) return "costProject";
  return "other";
}

function moduleIndexFromKey(key: string): string | undefined {
  for (const idx of MODULE_INDICES) {
    if (key.includes(idx)) return idx;
  }
  return undefined;
}

function fieldHitsForNeedle(entry: ReportEntry, needle: string): ProbeFieldHit[] {
  const n = needle.trim();
  if (!n) return [];
  const hits: ProbeFieldHit[] = [];
  for (const f of entry.contents) {
    const value = String(f.value ?? "").trim();
    if (!value.includes(n)) continue;
    hits.push({
      key: f.key,
      value: value.slice(0, 200),
      kind: classifyFieldKind(f.key),
      moduleIndex: moduleIndexFromKey(f.key),
    });
  }
  return hits;
}

function attachmentCount(entry: ReportEntry): number {
  let n = entry.images?.length ?? 0;
  for (const f of entry.contents) {
    n += f.type === "9" || f.key.includes("附件")
      ? parseAttachmentsFromValue(f.value).length
      : 0;
  }
  return n;
}

function firstAttachmentSample(entry: ReportEntry): ReportAttachment | undefined {
  for (const img of entry.images ?? []) {
    if (img.url || img.fileId) return img;
  }
  for (const f of entry.contents) {
    const att = parseAttachmentsFromValue(f.value);
    const a = att.find((x) => x.url || x.fileId);
    if (a) return a;
  }
  return undefined;
}

function uniqueTop(values: string[], limit: number): string[] {
  const counts = new Map<string, number>();
  for (const v of values) {
    const t = v.trim();
    if (!t) continue;
    counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([v]) => v);
}

function suggestFilterForKeyword(
  stats: Omit<ProbeKeywordStats, "suggestedFilter">,
): ProbeKeywordStats["suggestedFilter"] {
  const notes: string[] = [];
  const work = uniqueTop(stats.workModuleValueSamples, 3);
  const cost = uniqueTop(stats.costProjectValueSamples, 3);
  const otherHits = stats.fieldKindCounts.other ?? 0;
  const workHits = stats.fieldKindCounts.workModule ?? 0;
  const costHits = stats.fieldKindCounts.costProject ?? 0;

  if (workHits === 0 && costHits === 0 && otherHits > 0) {
    notes.push("关键词仅出现在非模块字段（如事项-结果）；现有成对 filter 可能无法命中，需扩展 keyword 规则。");
    return {
      workModuleContains: stats.needle,
      costProjectContains: stats.needle,
      confidence: "low",
      notes,
    };
  }

  const workModuleContains = work[0] ?? stats.needle;
  const costProjectContains = cost[0] ?? stats.needle;

  if (work[0] && cost[0]) {
    notes.push("建议用成对 filter：工作模块 + 成本归属项目各取高频全名子串。");
    return {
      workModuleContains,
      costProjectContains,
      confidence: "high",
      notes,
    };
  }

  if (work[0] || cost[0]) {
    notes.push("仅一侧字段有样本；成对 filter 另一侧暂用关键词，需探测后人工确认。");
    return {
      workModuleContains: work[0] ?? stats.needle,
      costProjectContains: cost[0] ?? stats.needle,
      confidence: "medium",
      notes,
    };
  }

  notes.push("无足够样本，暂用关键词作占位。");
  return {
    workModuleContains: stats.needle,
    costProjectContains: stats.needle,
    confidence: "low",
    notes,
  };
}

export function analyzeReportsForProductLineProbe(input: {
  contacts: Array<{ userid: string; name: string; reports: ReportEntry[] }>;
  keywords?: ProductLineProbeKeyword[];
  maxSamplesPerKeyword?: number;
}): ProductLineProbeResult {
  const keywords = input.keywords ?? DEFAULT_PRODUCT_LINE_KEYWORDS;
  const maxSamples = input.maxSamplesPerKeyword ?? 5;
  let scannedReportCount = 0;

  const keywordStats: ProbeKeywordStats[] = keywords.map((kw) => ({
    id: kw.id,
    label: kw.label,
    needle: kw.needle,
    hitReportCount: 0,
    hitUserCount: 0,
    userids: [],
    fieldKindCounts: { workModule: 0, costProject: 0, other: 0 },
    moduleIndexCounts: {},
    workModuleValueSamples: [],
    costProjectValueSamples: [],
    reportSamples: [],
  }));

  const kwByNeedle = new Map(keywords.map((k, i) => [k.needle, i]));

  for (const contact of input.contacts) {
    const userHitKeywords = new Set<number>();

    for (const report of contact.reports) {
      scannedReportCount += 1;
      for (const kw of keywords) {
        const ki = kwByNeedle.get(kw.needle)!;
        const hits = fieldHitsForNeedle(report, kw.needle);
        if (hits.length === 0) continue;

        const stats = keywordStats[ki]!;
        stats.hitReportCount += 1;
        userHitKeywords.add(ki);

        for (const h of hits) {
          stats.fieldKindCounts[h.kind] += 1;
          if (h.moduleIndex) {
            stats.moduleIndexCounts[h.moduleIndex] =
              (stats.moduleIndexCounts[h.moduleIndex] ?? 0) + 1;
          }
          if (h.kind === "workModule") stats.workModuleValueSamples.push(h.value);
          if (h.kind === "costProject") stats.costProjectValueSamples.push(h.value);
        }

        if (stats.reportSamples.length < maxSamples) {
          stats.reportSamples.push({
            reportId: report.reportId,
            creatorUserId: report.creatorUserId || contact.userid,
            creatorName: report.creatorName || contact.name,
            createTime: report.createTime,
            templateName: report.templateName,
            hits,
            imageCount: parseReportImages(report.images).length,
            attachmentCount: attachmentCount(report),
            attachmentSample: firstAttachmentSample(report),
          });
        }
      }
    }

    for (const ki of userHitKeywords) {
      const stats = keywordStats[ki]!;
      if (!stats.userids.includes(contact.userid)) {
        stats.userids.push(contact.userid);
        stats.hitUserCount = stats.userids.length;
      }
    }
  }

  for (const stats of keywordStats) {
    stats.suggestedFilter = suggestFilterForKeyword(stats);
  }

  return {
    scannedContactCount: input.contacts.length,
    scannedReportCount,
    keywords: keywordStats,
    generatedAt: new Date().toISOString(),
  };
}

/** 从模块块内提取与 needle 同块的工作模块/成本项目值（用于成对 filter 建议）。 */
export function extractModulePairValues(
  contents: ReportContentField[],
  needle: string,
): { work?: string; cost?: string; moduleIndex?: string } {
  for (const idx of MODULE_INDICES) {
    let work: string | undefined;
    let cost: string | undefined;
    let blockHasNeedle = false;
    for (const f of contents) {
      if (!f.key.includes(idx)) continue;
      const v = String(f.value ?? "").trim();
      if (v.includes(needle)) blockHasNeedle = true;
      if (f.key.includes("工作模块") && v) work = v;
      if (f.key.includes("成本归属项目") && v) cost = v;
    }
    if (blockHasNeedle) return { work, cost, moduleIndex: idx };
  }
  return {};
}
