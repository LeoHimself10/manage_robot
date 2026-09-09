import type { NormalizedQualitySourceRow } from "../source/quality-source-schema";
import type { AiOriginalAssessmentInput } from "./ai-original-assessment-contracts";

type OaContext = NonNullable<AiOriginalAssessmentInput["sourceSnapshot"]["oaContext"]>;

/** Read the immutable form snapshot, never fetch attachments or forward the OA payload. */
export function buildAiOaContext(source: NormalizedQualitySourceRow): OaContext | undefined {
  if (!source.sourceKey.startsWith("oa:")) return undefined;
  const raw = Object.fromEntries(Object.entries(source.rawSnapshot ?? {}).map(([key, value]) => [key.trim(), value]));
  const pick = (...labels: string[]): string | undefined => labels.map((label) => raw[label]?.trim()).find(Boolean);
  const attachments: OaContext["attachments"] = [];
  function visit(value: unknown, category: string, depth = 0): void {
    if (depth > 6 || attachments.length >= 64) return;
    if (typeof value === "string") {
      try { visit(JSON.parse(value), category, depth + 1); } catch { /* Plain text is not attachment metadata. */ }
      return;
    }
    if (Array.isArray(value)) { value.forEach((item) => visit(item, category, depth + 1)); return; }
    if (!value || typeof value !== "object") return;
    const file = value as Record<string, unknown>;
    const name = file.fileName ?? file.file_name ?? file.name;
    if (typeof name === "string" && name.trim() && !/^https?:/i.test(name.trim())) {
      const size = Number(file.fileSize ?? file.size);
      const mime = file.mimeType ?? file.fileType;
      attachments.push({
        category, name: name.trim(),
        ...(typeof mime === "string" && /^[\w.+-]+\/[\w.+-]+$/.test(mime) ? { mimeType: mime } : {}),
        ...(Number.isFinite(size) && size >= 0 ? { sizeBytes: size } : {}),
      });
      return;
    }
    for (const field of ["files", "attachments", "value"]) if (field in file) visit(file[field], category, depth + 1);
  }
  for (const category of ["服务日志导出并上传", "数据原始格式导出并上传", "上传问题记录图片及视频"]) {
    visit(raw[category], category);
  }
  return {
    productType: pick("产品类型选项", "产品类型"),
    catheterModel: pick("导管型号"), softwareVersion: pick("软件版本"),
    hospital: pick("WHERE"), occurredAt: pick("WHEN"), reproduction: pick("HOW"),
    occurrenceCount: pick("HOW MANY"), returnable: pick("导管是否可以回收寄回"),
    damagedCount: pick("本次报损的导管数量（条）", "本次报损的导管数量(条)"),
    attachmentContent: "NOT_ANALYZED", attachments,
  };
}
