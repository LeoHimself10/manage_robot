import { createHash } from "node:crypto";

export const QUALITY_SOURCE_HEADERS = {
  feedbackAt: ["反馈时间"],
  feedbackNo: ["反馈单号"],
  reporter: ["反馈人员", "反馈人"],
  deviceModel: ["设备型号"],
  serialNo: ["设备序列号"],
  catheterBatch: ["报损导管批次", "导管批次"],
  issueDescription: ["问题描述"],
  clinicianAware: ["术者是否可以感知"],
  impact: ["对术者造成的影响"],
  confirmation: ["确认情况", "问题描述内容 是否与反馈人员确认"],
  owner: ["责任人", "研发责任人"],
  returned: ["导管是否寄回"],
  category: ["问题归类"],
  status: ["状态"],
  solutionEngineer: ["解决工程师"],
  solution: ["解决工程师及方案", "解决方案", "问题解决工程师及解决方案"],
  finalCause: ["最终原因和解决措施", "最终原因分析与解决措施的结论"],
  customerFollowup: ["客服跟踪反馈", "客服部跟踪反馈"],
} as const;

export interface QualitySourceSheet {
  sheetId: string;
  sheetName: string;
  rows: unknown[][];
}

export interface NormalizedQualitySourceRow {
  sourceKey: string;
  rowNumber: number;
  contentHash: string;
  feedbackAt: string;
  feedbackNo: string;
  reporter: string;
  deviceModel: string;
  serialNo: string;
  catheterBatch: string;
  issueDescription: string;
  clinicianAware: string;
  impact: string;
  confirmation: string;
  owner: string;
  returned: string;
  category: string;
  status: string;
  solutionEngineer: string;
  solution: string;
  finalCause: string;
  customerFollowup: string;
  rawSnapshot: Record<string, string>;
}

type QualitySourceField = keyof typeof QUALITY_SOURCE_HEADERS;

function cleanCell(value: unknown): string {
  return String(value ?? "").trim();
}

function normalizeHeader(value: unknown): string {
  return cleanCell(value).replace(/\s+/g, " ");
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function stableJson(value: Record<string, unknown>): string {
  const sorted = Object.fromEntries(Object.keys(value).sort().map((key) => [key, value[key]]));
  return JSON.stringify(sorted);
}

function buildHeaderIndex(headers: unknown[]): {
  normalizedHeaders: string[];
  fieldIndexes: Partial<Record<QualitySourceField, number>>;
} {
  const normalizedHeaders = headers.map(normalizeHeader);
  const seen = new Set<string>();
  for (const header of normalizedHeaders) {
    if (!header) continue;
    if (seen.has(header)) throw new Error(`duplicate header: ${header}`);
    seen.add(header);
  }

  const fieldIndexes: Partial<Record<QualitySourceField, number>> = {};
  for (const [field, aliases] of Object.entries(QUALITY_SOURCE_HEADERS) as Array<[
    QualitySourceField,
    readonly string[],
  ]>) {
    const aliasSet = new Set(aliases.map(normalizeHeader));
    const index = normalizedHeaders.findIndex((header) => aliasSet.has(header));
    if (index >= 0) fieldIndexes[field] = index;
  }
  if (fieldIndexes.feedbackAt == null) throw new Error("required header missing: 反馈时间");
  if (fieldIndexes.issueDescription == null) throw new Error("required header missing: 问题描述");
  return { normalizedHeaders, fieldIndexes };
}

function sourceKeyFor(row: Pick<NormalizedQualitySourceRow,
  "feedbackNo" | "feedbackAt" | "reporter" | "serialNo" | "issueDescription"
>): string {
  if (row.feedbackNo) return `feedback:${row.feedbackNo}`;
  const fallback = [row.feedbackAt, row.reporter, row.serialNo, row.issueDescription]
    .map((value) => value.replace(/\s+/g, " ").trim())
    .join("\u001f");
  return `digest:${sha256(fallback)}`;
}

export function normalizeQualitySourceSheet(
  sheet: QualitySourceSheet,
): NormalizedQualitySourceRow[] {
  const headers = sheet.rows[0];
  if (!Array.isArray(headers) || headers.length === 0) {
    throw new Error("quality source header row is empty");
  }
  const { normalizedHeaders, fieldIndexes } = buildHeaderIndex(headers);
  const valueAt = (row: unknown[], field: QualitySourceField): string => {
    const index = fieldIndexes[field];
    return index == null ? "" : cleanCell(row[index]);
  };
  const normalizedRows: NormalizedQualitySourceRow[] = [];

  for (let index = 1; index < sheet.rows.length; index += 1) {
    const cells = Array.isArray(sheet.rows[index]) ? sheet.rows[index]! : [];
    if (!cells.some((cell) => cleanCell(cell))) continue;
    const rawSnapshot: Record<string, string> = {};
    normalizedHeaders.forEach((header, column) => {
      if (header) rawSnapshot[header] = cleanCell(cells[column]);
    });
    const row = {
      sourceKey: "",
      rowNumber: index + 1,
      contentHash: "",
      feedbackAt: valueAt(cells, "feedbackAt"),
      feedbackNo: valueAt(cells, "feedbackNo"),
      reporter: valueAt(cells, "reporter"),
      deviceModel: valueAt(cells, "deviceModel"),
      serialNo: valueAt(cells, "serialNo"),
      catheterBatch: valueAt(cells, "catheterBatch"),
      issueDescription: valueAt(cells, "issueDescription"),
      clinicianAware: valueAt(cells, "clinicianAware"),
      impact: valueAt(cells, "impact"),
      confirmation: valueAt(cells, "confirmation"),
      owner: valueAt(cells, "owner"),
      returned: valueAt(cells, "returned"),
      category: valueAt(cells, "category"),
      status: valueAt(cells, "status"),
      solutionEngineer: valueAt(cells, "solutionEngineer"),
      solution: valueAt(cells, "solution"),
      finalCause: valueAt(cells, "finalCause"),
      customerFollowup: valueAt(cells, "customerFollowup"),
      rawSnapshot,
    } satisfies NormalizedQualitySourceRow;
    row.sourceKey = sourceKeyFor(row);
    row.contentHash = sha256(stableJson(rawSnapshot));
    normalizedRows.push(row);
  }
  return normalizedRows;
}

