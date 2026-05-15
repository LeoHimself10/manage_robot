import type { IncomingMessage } from "node:http";
import Busboy from "busboy";

/**
 * 解析 multipart/form-data 中的"单文件 + 同名 form 字段"。
 *
 * 设计取舍：
 * - 我们只用一个上传场景（主管上传花名册），因此不抽象成通用 multipart 路由；
 *   返回结构对应业务最小集：第一个文件 + 平铺的字符串字段 map。
 * - 文件大小硬上限通过 busboy.fileSize + 显式 limitReached 检测双重保险。
 * - 多于一个文件时只读第一个，其余 stream 立即丢弃，避免上游误传一堆图片把内存撑爆。
 * - 失败统一抛 Error；调用方决定 4xx / 500 + 用户文案。
 */
export interface MultipartFile {
  fieldName: string;
  filename: string;
  mimeType: string;
  buffer: Buffer;
  truncated: boolean;
}

export interface MultipartSingleFileResult {
  file?: MultipartFile;
  fields: Record<string, string>;
}

export interface MultipartSingleFileOptions {
  /** 文件 byte 上限，默认 2 MB。 */
  maxFileBytes?: number;
  /** 字段总数上限，默认 20。 */
  maxFields?: number;
  /** 字段单个值字符上限，默认 4 KB。 */
  maxFieldChars?: number;
}

const DEFAULT_MAX_FILE_BYTES = 2 * 1024 * 1024;

/**
 * Busboy 默认 `defParamCharset: latin1`，会把 UTF-8 文件名误解成 mojibake。
 * 在已启用 `defParamCharset: utf8` 后，仍对少数客户端用 latin1 传 UTF-8 字节的情况做兜底反转。
 */
export function fixMultipartFilenameEncoding(name: string): string {
  const trimmed = String(name ?? "").trim();
  if (!trimmed) return trimmed;
  // 典型 UTF-8 被按 latin1 读入后会出现大量 U+0080–U+00FF 区段字符，且通常不含正常中文 BMP。
  const hasHighByteChars = /[\u0080-\u00ff]{2,}/.test(trimmed);
  const hasCjk = /[\u4e00-\u9fff]/.test(trimmed);
  if (!hasHighByteChars || hasCjk) return trimmed;
  try {
    const fixed = Buffer.from(trimmed, "latin1").toString("utf8");
    if (!fixed || fixed === trimmed) return trimmed;
    if (/[\u4e00-\u9fff]/.test(fixed)) return fixed.trim() || trimmed;
    return trimmed;
  } catch {
    return trimmed;
  }
}

export function readMultipartSingleFile(
  req: IncomingMessage,
  options: MultipartSingleFileOptions = {},
): Promise<MultipartSingleFileResult> {
  const maxFileBytes = options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
  const maxFields = options.maxFields ?? 20;
  const maxFieldChars = options.maxFieldChars ?? 4096;

  return new Promise((resolve, reject) => {
    const contentType = String(req.headers["content-type"] ?? "").trim();
    if (!contentType.toLowerCase().startsWith("multipart/")) {
      reject(new Error("Content-Type must be multipart/form-data"));
      return;
    }

    let bb: ReturnType<typeof Busboy>;
    try {
      bb = Busboy({
        headers: req.headers,
        defParamCharset: "utf8",
        limits: {
          fileSize: maxFileBytes,
          files: 5,
          fields: maxFields,
          fieldSize: maxFieldChars,
        },
      });
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)));
      return;
    }

    const fields: Record<string, string> = {};
    let firstFile: MultipartFile | undefined;
    let firstFileChunks: Buffer[] = [];
    let firstFileTruncated = false;
    let settled = false;

    function settleOk(): void {
      if (settled) return;
      settled = true;
      if (firstFile && firstFileChunks.length > 0) {
        firstFile.buffer = Buffer.concat(firstFileChunks);
        firstFile.truncated = firstFileTruncated;
      }
      resolve({ file: firstFile, fields });
    }

    function settleErr(err: Error): void {
      if (settled) return;
      settled = true;
      reject(err);
    }

    bb.on("field", (name, value) => {
      if (Object.keys(fields).length >= maxFields) return;
      fields[String(name)] = String(value).slice(0, maxFieldChars);
    });

    bb.on("file", (fieldName, fileStream, info) => {
      if (firstFile) {
        // 已收到第一个文件：把多余的文件流耗尽并丢弃，避免请求 hang
        fileStream.resume();
        return;
      }
      firstFile = {
        fieldName: String(fieldName),
        filename:
          fixMultipartFilenameEncoding(String(info?.filename ?? "").trim()) || "upload.bin",
        mimeType: String(info?.mimeType ?? "").trim() || "application/octet-stream",
        buffer: Buffer.alloc(0),
        truncated: false,
      };
      fileStream.on("data", (chunk: Buffer) => {
        firstFileChunks.push(chunk);
      });
      fileStream.on("limit", () => {
        firstFileTruncated = true;
      });
      fileStream.on("error", (err) => {
        settleErr(err instanceof Error ? err : new Error(String(err)));
      });
    });

    bb.on("error", (err: unknown) => {
      settleErr(err instanceof Error ? err : new Error(String(err)));
    });

    bb.on("close", () => {
      if (firstFileTruncated) {
        settleErr(
          new Error(`uploaded file exceeded ${maxFileBytes} bytes (truncated)`),
        );
        return;
      }
      settleOk();
    });

    req.on("error", (err) => settleErr(err));

    req.pipe(bb);
  });
}
