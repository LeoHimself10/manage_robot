import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import type { NormalizedQualitySourceRow } from "../source/quality-source-schema";
import type {
  AiOriginalAssessmentInput,
} from "./ai-original-assessment-contracts";
import { HISTORICAL_FEEDBACK_TAXONOMY_V0 } from
  "./historical-feedback-taxonomy-v0";

export const HISTORICAL_FEEDBACK_CASE_INDEX_VERSION =
  "HISTORICAL_FEEDBACK_CASE_INDEX_V0" as const;
export const DEFAULT_HISTORICAL_FEEDBACK_MIN_SIMILARITY = 0.34;

const indexRecordSchema = z.object({
  caseId: z.string().trim().min(1),
  sourceKeyHash: z.string().regex(/^[a-f0-9]{64}$/i),
  recordFingerprint: z.string().regex(/^[a-f0-9]{64}$/i),
  sourceRow: z.number().int().positive(),
  feedbackAt: z.string(),
  deviceModel: z.string(),
  issueDescription: z.string(),
  primaryCategoryCode: z.string().trim().min(1),
  secondaryCategoryCode: z.string().trim().min(1),
  outcome: z.string().trim().min(1),
  sourceReference: z.string().trim().min(1),
}).strict();

const indexSchema = z.object({
  version: z.literal(HISTORICAL_FEEDBACK_CASE_INDEX_VERSION),
  sourceRecordCount: z.number().int().positive(),
  generatedFrom: z.string().trim().min(1),
  records: z.array(indexRecordSchema),
}).strict().superRefine((index, context) => {
  if (index.records.length !== index.sourceRecordCount) {
    context.addIssue({
      code: "custom",
      path: ["records"],
      message: "历史案例索引记录数与sourceRecordCount不一致",
    });
  }
});

export type HistoricalFeedbackCaseIndexRecord = z.infer<typeof indexRecordSchema>;
export type HistoricalFeedbackCaseIndex = z.infer<typeof indexSchema>;

export interface RetrievedHistoricalFeedbackCaseMatch {
  case: AiOriginalAssessmentInput["retrievedCases"][number];
  score: number;
  sourceRow: number;
  matchedKeyTerms: string[];
  deviceModelMatched: boolean;
}

export interface HistoricalFeedbackCaseRetriever {
  readonly version: string;
  retrieve(
    feedback: NormalizedQualitySourceRow,
  ): AiOriginalAssessmentInput["retrievedCases"];
}

const DEFAULT_INDEX_PATH = fileURLToPath(
  new URL("./historical-feedback-v0-case-index.json", import.meta.url),
);

const DOMAIN_TERMS = Array.from(new Set(
  HISTORICAL_FEEDBACK_TAXONOMY_V0.categories.flatMap((primary) =>
    primary.secondaryCategories.flatMap((secondary) => [
      secondary.secondaryLabel,
      ...secondary.typicalExpressions,
    ])),
)).map(normalizeText).filter((term) => term.length >= 2);

const ATTACHMENT_ONLY_PATTERN = /^(?:[\w\u4e00-\u9fff .()（）_-]+\.(?:mp4|mov|avi|mkv|jpg|jpeg|png|gif|bmp|heic|pdf|docx?|xlsx?))(?:\s*[,，;；]\s*[\w\u4e00-\u9fff .()（）_-]+\.(?:mp4|mov|avi|mkv|jpg|jpeg|png|gif|bmp|heic|pdf|docx?|xlsx?))*$/i;

function normalizeText(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{Script=Han}a-z0-9]+/gu, "")
    .trim();
}

function normalizedModel(value: string): string {
  const model = normalizeText(value);
  return ["", "未知", "不详", "null"].includes(model) ? "" : model;
}

export function isAttachmentOnlyDescription(value: string): boolean {
  return ATTACHMENT_ONLY_PATTERN.test(value.trim());
}

function ngrams(value: string, size = 2): Set<string> {
  const text = normalizeText(value);
  if (!text) return new Set();
  if (text.length <= size) return new Set([text]);
  const result = new Set<string>();
  for (let index = 0; index <= text.length - size; index += 1) {
    result.add(text.slice(index, index + size));
  }
  return result;
}

function dice(left: Set<string>, right: Set<string>): number {
  if (left.size === 0 || right.size === 0) return 0;
  let intersection = 0;
  for (const value of left) {
    if (right.has(value)) intersection += 1;
  }
  return (2 * intersection) / (left.size + right.size);
}

function extractKeyTerms(value: string): Set<string> {
  const normalized = normalizeText(value);
  const terms = new Set<string>();
  for (const term of DOMAIN_TERMS) {
    if (normalized.includes(term)) terms.add(term);
  }
  for (const match of value.matchAll(/\b(?:\d{3,4}|0db|piu|nurd|ica|oct|ivus)\b/gi)) {
    terms.add(match[0]!.toLowerCase());
  }
  return terms;
}

function sharedValues(left: Set<string>, right: Set<string>): string[] {
  return Array.from(left).filter((value) => right.has(value)).sort();
}

function categoryExists(primaryCode: string, secondaryCode: string): boolean {
  return HISTORICAL_FEEDBACK_TAXONOMY_V0.categories.some(
    (primary) => primary.primaryCode === primaryCode
      && primary.secondaryCategories.some(
        (secondary) => secondary.secondaryCode === secondaryCode,
      ),
  );
}

function isExcludedCandidate(record: HistoricalFeedbackCaseIndexRecord): boolean {
  const issue = record.issueDescription.trim();
  return !issue
    || isAttachmentOnlyDescription(issue)
    || record.secondaryCategoryCode === "INSUFFICIENT_INFO"
    || !categoryExists(record.primaryCategoryCode, record.secondaryCategoryCode);
}

function isCurrentRecord(
  feedback: NormalizedQualitySourceRow,
  record: HistoricalFeedbackCaseIndexRecord,
): boolean {
  if (createHash("sha256").update(feedback.sourceKey).digest("hex") === record.sourceKeyHash) {
    return true;
  }
  const fingerprint = createHash("sha256").update(JSON.stringify([
    feedback.feedbackAt.replace(/\s+/g, " ").trim(),
    feedback.deviceModel.replace(/\s+/g, " ").trim(),
    feedback.issueDescription.replace(/\s+/g, " ").trim(),
  ])).digest("hex");
  if (fingerprint === record.recordFingerprint) return true;
  return normalizeText(feedback.issueDescription) === normalizeText(record.issueDescription)
    && normalizedModel(feedback.deviceModel) === normalizedModel(record.deviceModel)
    && normalizeText(feedback.feedbackAt) === normalizeText(record.feedbackAt);
}

function scoreRecord(
  feedback: NormalizedQualitySourceRow,
  record: HistoricalFeedbackCaseIndexRecord,
): Omit<RetrievedHistoricalFeedbackCaseMatch, "case" | "sourceRow"> {
  const queryTerms = extractKeyTerms(feedback.issueDescription);
  const candidateTerms = extractKeyTerms(record.issueDescription);
  const matchedKeyTerms = sharedValues(queryTerms, candidateTerms);
  const characterScore = dice(
    ngrams(feedback.issueDescription),
    ngrams(record.issueDescription),
  );
  const keyTermScore = dice(queryTerms, candidateTerms);
  const queryModel = normalizedModel(feedback.deviceModel);
  const candidateModel = normalizedModel(record.deviceModel);
  const deviceModelMatched = Boolean(queryModel && candidateModel && queryModel === candidateModel);
  const score = (0.65 * characterScore)
    + (0.27 * keyTermScore)
    + (deviceModelMatched ? 0.08 : 0);
  return {
    score: Number(score.toFixed(4)),
    matchedKeyTerms,
    deviceModelMatched,
  };
}

function toAiHistoricalCase(
  record: HistoricalFeedbackCaseIndexRecord,
): AiOriginalAssessmentInput["retrievedCases"][number] {
  const model = record.deviceModel || "未注明型号";
  const description = record.issueDescription.length > 42
    ? `${record.issueDescription.slice(0, 41)}…`
    : record.issueDescription;
  return {
    caseId: record.caseId,
    title: `${model}：${description}`,
    summary: record.issueDescription,
    primaryCategoryCode: record.primaryCategoryCode,
    secondaryCategoryCode: record.secondaryCategoryCode,
    outcome: record.outcome,
    sourceReference: record.sourceReference,
  };
}

export class LocalHistoricalFeedbackCaseRetriever implements HistoricalFeedbackCaseRetriever {
  readonly version: string;

  constructor(
    private readonly index: HistoricalFeedbackCaseIndex,
    private readonly minimumSimilarity = DEFAULT_HISTORICAL_FEEDBACK_MIN_SIMILARITY,
    private readonly maximumResults = 3,
  ) {
    this.version = index.version;
    if (minimumSimilarity < 0 || minimumSimilarity > 1) {
      throw new Error("minimumSimilarity必须在0到1之间");
    }
    if (!Number.isInteger(maximumResults) || maximumResults < 0 || maximumResults > 3) {
      throw new Error("maximumResults必须是0到3之间的整数");
    }
  }

  retrieveMatches(feedback: NormalizedQualitySourceRow): RetrievedHistoricalFeedbackCaseMatch[] {
    const issue = feedback.issueDescription.trim();
    if (!issue || isAttachmentOnlyDescription(issue) || this.maximumResults === 0) return [];

    return this.index.records
      .filter((record) => !isExcludedCandidate(record) && !isCurrentRecord(feedback, record))
      .map((record) => ({
        case: toAiHistoricalCase(record),
        sourceRow: record.sourceRow,
        ...scoreRecord(feedback, record),
      }))
      .filter((match) => match.score >= this.minimumSimilarity)
      .sort((left, right) => right.score - left.score || left.sourceRow - right.sourceRow)
      .slice(0, this.maximumResults);
  }

  retrieve(feedback: NormalizedQualitySourceRow): AiOriginalAssessmentInput["retrievedCases"] {
    return this.retrieveMatches(feedback).map((match) => match.case);
  }
}

export function loadHistoricalFeedbackCaseIndex(
  indexPath = DEFAULT_INDEX_PATH,
): HistoricalFeedbackCaseIndex {
  return indexSchema.parse(JSON.parse(readFileSync(indexPath, "utf8")));
}

export function createDefaultHistoricalFeedbackCaseRetriever(options: {
  minimumSimilarity?: number;
  maximumResults?: number;
  indexPath?: string;
} = {}): LocalHistoricalFeedbackCaseRetriever {
  return new LocalHistoricalFeedbackCaseRetriever(
    loadHistoricalFeedbackCaseIndex(options.indexPath),
    options.minimumSimilarity ?? DEFAULT_HISTORICAL_FEEDBACK_MIN_SIMILARITY,
    options.maximumResults ?? 3,
  );
}
