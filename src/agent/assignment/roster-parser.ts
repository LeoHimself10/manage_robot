/**
 * 主管上传花名册 (md / docx / pdf / 纯文本) → 提取纯文本，供 orchestrator 后续做姓名匹配。
 *
 * 设计要点：
 * - 解析失败/不支持类型时不抛裸 Error，统一返回 { ok: false, reason }，便于 HTTP/钉钉两侧调用方
 *   把"为什么失败"如实回给主管。
 * - 单文件硬上限：默认 2 MB（足够 200 人花名册）；超限直接拒绝，避免我们把巨型 pdf 喂进 LLM。
 * - 提取后的文本统一去 BOM、规范换行、合并 3+ 连续空行；不做结构化解析，姓名识别完全交给 LLM。
 *
 * 不做的事：
 * - 不在本模块内调用 LLM。本模块只负责 IO + 文本提取，避免在上传 / 钉钉回调路径上引入 LLM 延迟。
 * - 不写盘 / 不写 session；调用方决定如何持久化。
 */

import { extname } from "node:path";

export type RosterMimeKind = "markdown" | "docx" | "pdf" | "text";

export interface RosterParseInput {
  /** 上传的原始文件名（含扩展名）。用作 mime 兜底判断与 sourceLabel。 */
  filename: string;
  /** 浏览器/钉钉给的 MIME；不可信，仅作辅助判断。 */
  mimeType?: string;
  /** 文件二进制。 */
  buffer: Buffer;
  /** 上限字节，默认 2 MB。 */
  maxBytes?: number;
}

export interface RosterParseSuccess {
  ok: true;
  kind: RosterMimeKind;
  text: string;
  /** 解析后字符数；用于审计。 */
  chars: number;
  /** 文件 byte size；用于审计。 */
  bytes: number;
  sourceLabel: string;
}

export interface RosterParseFailure {
  ok: false;
  reason:
    | "empty_file"
    | "file_too_large"
    | "unsupported_type"
    | "parse_failed"
    | "extracted_empty";
  /** 用户可读说明（中文）。 */
  message: string;
  bytes: number;
}

export type RosterParseResult = RosterParseSuccess | RosterParseFailure;

const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;
const MAX_TEXT_CHARS = 60_000; // 防止把 5 万字论文当花名册扔给 LLM

export function detectRosterKind(filename: string, mimeType?: string): RosterMimeKind | undefined {
  const lower = filename.trim().toLowerCase();
  const mime = (mimeType ?? "").trim().toLowerCase();
  const ext = extname(lower);
  if (ext === ".md" || ext === ".markdown" || mime === "text/markdown") return "markdown";
  if (ext === ".txt" || mime === "text/plain") return "text";
  if (
    ext === ".docx" ||
    mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
    return "docx";
  }
  if (ext === ".pdf" || mime === "application/pdf") return "pdf";
  return undefined;
}

export async function parseRosterFile(input: RosterParseInput): Promise<RosterParseResult> {
  const bytes = input.buffer.byteLength;
  const maxBytes = input.maxBytes ?? DEFAULT_MAX_BYTES;
  if (bytes === 0) {
    return {
      ok: false,
      reason: "empty_file",
      message: "上传的文件为空。",
      bytes,
    };
  }
  if (bytes > maxBytes) {
    return {
      ok: false,
      reason: "file_too_large",
      message: `文件超过 ${(maxBytes / 1024 / 1024).toFixed(1)} MB 上限，请精简后再上传。`,
      bytes,
    };
  }

  const kind = detectRosterKind(input.filename, input.mimeType);
  if (!kind) {
    return {
      ok: false,
      reason: "unsupported_type",
      message: `仅支持 .md / .markdown / .txt / .docx / .pdf；当前文件 \`${input.filename}\` 无法识别。`,
      bytes,
    };
  }

  let extracted: string;
  try {
    if (kind === "markdown" || kind === "text") {
      extracted = stripBom(input.buffer.toString("utf8"));
    } else if (kind === "docx") {
      extracted = await extractDocx(input.buffer);
    } else {
      extracted = await extractPdf(input.buffer);
    }
  } catch (err) {
    return {
      ok: false,
      reason: "parse_failed",
      message: `解析 ${kind} 文件失败：${err instanceof Error ? err.message : String(err)}`,
      bytes,
    };
  }

  const normalized = normalizeText(extracted).slice(0, MAX_TEXT_CHARS);
  if (!normalized.trim()) {
    return {
      ok: false,
      reason: "extracted_empty",
      message: "文件解析后为空文本。请确认文件可读、未加密、未保存为图片型 PDF。",
      bytes,
    };
  }

  return {
    ok: true,
    kind,
    text: normalized,
    chars: normalized.length,
    bytes,
    sourceLabel: `uploaded:${input.filename.trim() || "roster"}`,
  };
}

function stripBom(s: string): string {
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

function normalizeText(raw: string): string {
  return stripBom(raw)
    .replace(/\r\n?/g, "\n")
    .replace(/[\t ]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function extractDocx(buffer: Buffer): Promise<string> {
  const mammoth = await import("mammoth");
  const result = await mammoth.extractRawText({ buffer });
  return String(result?.value ?? "");
}

async function extractPdf(buffer: Buffer): Promise<string> {
  // pdfjs-dist 在 Node 下需要传入 Uint8Array，且要走 legacy build 来兜底 ESM/CJS 兼容。
  // 这里禁用 worker 以避免 worker 文件路径解析问题。
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  // pdfjs-dist v5 在 Node 下：不传 worker / 显式置空字符串 → 走 fake worker，无需独立 worker 文件
  pdfjs.GlobalWorkerOptions.workerSrc = "";
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(buffer),
    isEvalSupported: false,
    useSystemFonts: false,
  } as unknown as Parameters<typeof pdfjs.getDocument>[0]);
  const doc = await loadingTask.promise;
  const lines: string[] = [];
  try {
    const maxPages = Math.min(doc.numPages, 100); // 100 页足够；防止恶意大 pdf
    for (let pageIndex = 1; pageIndex <= maxPages; pageIndex += 1) {
      const page = await doc.getPage(pageIndex);
      const textContent = await page.getTextContent();
      const pageLines: string[] = [];
      let currentLine = "";
      let lastY: number | undefined;
      for (const item of textContent.items as Array<{
        str?: string;
        transform?: number[];
        hasEOL?: boolean;
      }>) {
        const str = String(item?.str ?? "");
        const y = Array.isArray(item?.transform) ? Number(item.transform[5]) : undefined;
        if (lastY !== undefined && y !== undefined && Math.abs(y - lastY) > 2) {
          if (currentLine.trim()) pageLines.push(currentLine);
          currentLine = "";
        }
        currentLine += str;
        if (item?.hasEOL) {
          if (currentLine.trim()) pageLines.push(currentLine);
          currentLine = "";
        }
        lastY = y;
      }
      if (currentLine.trim()) pageLines.push(currentLine);
      lines.push(pageLines.join("\n"));
      page.cleanup();
    }
  } finally {
    await doc.destroy();
  }
  return lines.join("\n\n");
}

const DEFAULT_ROSTER_MATCH_MAX_NAMES = 50;

function rosterMatchMaxNames(): number {
  const raw = Number(String(process.env.ROSTER_MATCH_MAX_NAMES ?? "").trim());
  if (Number.isFinite(raw) && raw > 0) return Math.min(500, Math.floor(raw));
  return DEFAULT_ROSTER_MATCH_MAX_NAMES;
}

/**
 * 从花名册纯文本抽取候选人姓名（Markdown `## 标题` 为主）。
 * 不做 LLM；姓名识别交给本函数 + match_roster_to_contacts 批量查表。
 */
export function extractNamesFromRosterText(text: string): string[] {
  const maxNames = rosterMatchMaxNames();
  const seen = new Set<string>();
  const out: string[] = [];
  const lines = String(text ?? "").split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();
    const m = /^#{2,3}\s+(.+?)\s*$/.exec(trimmed);
    if (!m) continue;
    let name = m[1]!.trim();
    name = name.replace(/\s*[（(].*[)）]\s*$/u, "").trim();
    if (!name || name.length > 20) continue;
    if (seen.has(name)) continue;
    seen.add(name);
    out.push(name);
    if (out.length >= maxNames) break;
  }

  return out;
}
