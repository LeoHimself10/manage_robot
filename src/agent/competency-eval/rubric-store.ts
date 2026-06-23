import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import { join } from "node:path";

import { parseRosterFile, type RosterMimeKind } from "../assignment/roster-parser";
import {
  extractRubricFromText,
  type ExtractedRubric,
  type RubricDimension,
} from "./rubric-extract";

export interface RubricListItem {
  rubricId: string;
  title: string;
  dimensionCount: number;
  uploadedAt: string;
  originalFilename: string;
}

interface RubricMeta {
  rubricId: string;
  title: string;
  originalFilename: string;
  uploadedAt: string;
  mimeKind: RosterMimeKind;
  needsLlmFallback?: boolean;
}

interface StoredExtracted extends ExtractedRubric {
  rubricId: string;
  originalFilename: string;
  uploadedAt: string;
}

const DEFAULT_MAX_RUBRICS = 20;
const ACCEPTED_KINDS: RosterMimeKind[] = ["markdown", "docx"];

export function resolveCompetencyEvalDataDir(): string {
  const raw = String(process.env.COMPETENCY_EVAL_DATA_DIR ?? "").trim();
  return raw || "data/competency-eval";
}

function resolveMaxRubricsPerUser(explicit?: number): number {
  if (explicit !== undefined) return explicit;
  const raw = String(process.env.COMPETENCY_EVAL_MAX_RUBRICS_PER_USER ?? "").trim();
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_RUBRICS;
}

function sanitizeId(id: string): string | null {
  const trimmed = String(id ?? "").trim();
  if (!trimmed || trimmed.includes("/") || trimmed.includes("\\") || trimmed.includes("..")) {
    return null;
  }
  return trimmed;
}

function userRubricsRoot(userId: string): string | null {
  const id = sanitizeId(userId);
  if (!id) return null;
  return join(resolveCompetencyEvalDataDir(), "users", id, "rubrics");
}

function rubricDir(userId: string, rubricId: string): string | null {
  const root = userRubricsRoot(userId);
  const rid = sanitizeId(rubricId);
  if (!root || !rid) return null;
  return join(root, rid);
}

function writeJsonAtomic(path: string, obj: unknown): void {
  const tmp = `${path}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, `${JSON.stringify(obj, null, 2)}\n`, "utf8");
  fs.renameSync(tmp, path);
}

function readMeta(dir: string): RubricMeta | null {
  const metaPath = join(dir, "meta.json");
  if (!fs.existsSync(metaPath)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(metaPath, "utf8")) as RubricMeta;
    if (!parsed?.rubricId || !parsed.title) return null;
    return parsed;
  } catch {
    return null;
  }
}

function metaToListItem(meta: RubricMeta, dir: string): RubricListItem {
  let dimensionCount = 0;
  const extractedPath = join(dir, "extracted.json");
  if (fs.existsSync(extractedPath)) {
    try {
      const extracted = JSON.parse(fs.readFileSync(extractedPath, "utf8")) as StoredExtracted;
      dimensionCount = Array.isArray(extracted.dimensions) ? extracted.dimensions.length : 0;
    } catch {
      // ignore corrupt extracted.json for listing
    }
  }
  return {
    rubricId: meta.rubricId,
    title: meta.title,
    dimensionCount,
    uploadedAt: meta.uploadedAt,
    originalFilename: meta.originalFilename,
  };
}

export async function saveUploadedRubric(input: {
  userId: string;
  filename: string;
  mimeType?: string;
  buffer: Buffer;
  maxRubrics?: number;
}): Promise<
  | { ok: true; rubric: RubricListItem & { dimensions: RubricDimension[] } }
  | { ok: false; reason: string; message: string }
> {
  const root = userRubricsRoot(input.userId);
  if (!root) {
    return { ok: false, reason: "invalid_user", message: "无效的用户标识。" };
  }

  const maxRubrics = resolveMaxRubricsPerUser(input.maxRubrics);
  if (listRubrics(input.userId).length >= maxRubrics) {
    return {
      ok: false,
      reason: "max_rubrics_reached",
      message: `每位用户最多保存 ${maxRubrics} 份评估标准，请先删除旧文件再上传。`,
    };
  }

  const parsed = await parseRosterFile({
    filename: input.filename,
    mimeType: input.mimeType,
    buffer: input.buffer,
  });
  if (!parsed.ok) {
    return { ok: false, reason: parsed.reason, message: parsed.message };
  }
  if (!ACCEPTED_KINDS.includes(parsed.kind)) {
    return {
      ok: false,
      reason: "unsupported_type",
      message: `能力评估标准仅支持 .md / .docx 格式；当前为 ${parsed.kind}，请转换后重试。`,
    };
  }

  const extracted = extractRubricFromText(parsed.text);
  const rubricId = randomUUID();
  const uploadedAt = new Date().toISOString();
  const originalFilename = input.filename.trim() || "upload.md";

  const dir = join(root, rubricId);
  fs.mkdirSync(dir, { recursive: true });

  const meta: RubricMeta = {
    rubricId,
    title: extracted.title,
    originalFilename,
    uploadedAt,
    mimeKind: parsed.kind,
    ...(extracted.needsLlmFallback ? { needsLlmFallback: true } : {}),
  };
  const storedExtracted: StoredExtracted = {
    ...extracted,
    rubricId,
    originalFilename,
    uploadedAt,
  };

  fs.writeFileSync(join(dir, "source.md"), parsed.text, "utf8");
  writeJsonAtomic(join(dir, "extracted.json"), storedExtracted);
  writeJsonAtomic(join(dir, "meta.json"), meta);

  return {
    ok: true,
    rubric: {
      rubricId,
      title: extracted.title,
      dimensionCount: extracted.dimensions.length,
      uploadedAt,
      originalFilename,
      dimensions: extracted.dimensions,
    },
  };
}

export function listRubrics(userId: string): RubricListItem[] {
  const root = userRubricsRoot(userId);
  if (!root || !fs.existsSync(root)) return [];

  const items: RubricListItem[] = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = join(root, entry.name);
    const meta = readMeta(dir);
    if (!meta) continue;
    items.push(metaToListItem(meta, dir));
  }
  return items.sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
}

export function getRubric(
  userId: string,
  rubricId: string,
):
  | { ok: true; sourceMarkdown: string; extracted: ExtractedRubric & { rubricId: string } }
  | { ok: false; reason: string } {
  const dir = rubricDir(userId, rubricId);
  if (!dir || !fs.existsSync(dir)) {
    return { ok: false, reason: "not_found" };
  }

  const sourcePath = join(dir, "source.md");
  const extractedPath = join(dir, "extracted.json");
  if (!fs.existsSync(sourcePath) || !fs.existsSync(extractedPath)) {
    return { ok: false, reason: "not_found" };
  }

  try {
    const sourceMarkdown = fs.readFileSync(sourcePath, "utf8");
    const stored = JSON.parse(fs.readFileSync(extractedPath, "utf8")) as StoredExtracted;
    const { rubricId: storedId, originalFilename: _fn, uploadedAt: _at, ...extractedFields } =
      stored;
    return {
      ok: true,
      sourceMarkdown,
      extracted: {
        ...extractedFields,
        rubricId: storedId || rubricId,
      },
    };
  } catch {
    return { ok: false, reason: "corrupt" };
  }
}

export function deleteRubric(userId: string, rubricId: string): boolean {
  const dir = rubricDir(userId, rubricId);
  if (!dir || !fs.existsSync(dir)) return false;
  fs.rmSync(dir, { recursive: true, force: true });
  return true;
}
