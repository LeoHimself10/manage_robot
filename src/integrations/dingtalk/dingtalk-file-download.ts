/**
 * 钉钉机器人收到的 file 消息：payload 里只有 downloadCode，需要走 robot/messageFiles/download
 * 接口换成临时下载 URL，再 GET 拿真正的 bytes。
 *
 * 接口：POST https://api.dingtalk.com/v1.0/robot/messageFiles/download
 *      header: x-acs-dingtalk-access-token: {accessToken}
 *      body:   { downloadCode, robotCode }
 *      resp:   { downloadUrl }
 *
 * 我们只下载用，不重放给钉钉，因此不持久化 downloadUrl；同一 downloadCode 的 URL 通常 5min 内有效。
 *
 * 设计取舍：
 * - accessToken 由调用方提供（dingtalk-stream 的 DWClient.getAccessToken() 已实现），不在这里再抢一份。
 * - 失败抛 DingTalkFileDownloadError，调用方决定如何回复用户。
 * - 单文件硬上限：默认 4 MB（罗斯特 2 MB 的两倍 buffer，供 future 其它消息复用）。
 */

const DOWNLOAD_API = "https://api.dingtalk.com/v1.0/robot/messageFiles/download";
const DEFAULT_FETCH_TIMEOUT_MS = 20_000;
const DEFAULT_MAX_BYTES = 4 * 1024 * 1024;

/** Extra fields for `dingtalk_roster_download_failed` / client diagnostics (no secrets). */
export type DingTalkResolveErrorMeta = {
  httpStatus: number;
  apiErrcode?: string | number;
  apiErrmsg?: string;
  /** Response body snippet (trimmed, capped) or "(empty body)". */
  rawSnippet: string;
};

export class DingTalkFileDownloadError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "MISSING_DOWNLOAD_CODE"
      | "MISSING_ROBOT_CODE"
      | "MISSING_ACCESS_TOKEN"
      | "RESOLVE_URL_FAILED"
      | "FETCH_FAILED"
      | "FILE_TOO_LARGE",
    public readonly statusCode = 502,
    public readonly resolveMeta?: DingTalkResolveErrorMeta,
  ) {
    super(message);
    this.name = "DingTalkFileDownloadError";
  }
}

export interface FetchDingTalkFileInput {
  downloadCode: string;
  robotCode: string;
  accessToken: string;
  /** 限定大小，超出抛 FILE_TOO_LARGE。默认 4 MB。 */
  maxBytes?: number;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export interface FetchDingTalkFileResult {
  buffer: Buffer;
  /** Content-Disposition 解析出的服务器返回文件名（可能为空）。 */
  filename?: string;
  /** Content-Type；钉钉 OSS 一般会给一个合理的 mime。 */
  mimeType?: string;
}

export async function fetchDingTalkFile(
  input: FetchDingTalkFileInput,
): Promise<FetchDingTalkFileResult> {
  if (!input.downloadCode?.trim()) {
    throw new DingTalkFileDownloadError("downloadCode is required", "MISSING_DOWNLOAD_CODE", 400);
  }
  if (!input.robotCode?.trim()) {
    throw new DingTalkFileDownloadError("robotCode is required", "MISSING_ROBOT_CODE", 400);
  }
  if (!input.accessToken?.trim()) {
    throw new DingTalkFileDownloadError("accessToken is required", "MISSING_ACCESS_TOKEN", 500);
  }

  const fetchImpl = input.fetchImpl ?? fetch;
  const timeoutMs = input.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS;
  const maxBytes = input.maxBytes ?? DEFAULT_MAX_BYTES;

  const downloadUrl = await resolveDownloadUrl(input, fetchImpl, timeoutMs);

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetchImpl(downloadUrl, { method: "GET", signal: ctrl.signal });
  } catch (err) {
    throw new DingTalkFileDownloadError(
      `download fetch failed: ${err instanceof Error ? err.message : String(err)}`,
      "FETCH_FAILED",
    );
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    throw new DingTalkFileDownloadError(
      `download HTTP ${res.status}`,
      "FETCH_FAILED",
    );
  }
  const contentLengthHeader = res.headers.get("content-length");
  if (contentLengthHeader) {
    const cl = Number(contentLengthHeader);
    if (Number.isFinite(cl) && cl > maxBytes) {
      throw new DingTalkFileDownloadError(
        `file too large: ${cl} > ${maxBytes}`,
        "FILE_TOO_LARGE",
        413,
      );
    }
  }
  const arrayBuf = await res.arrayBuffer();
  if (arrayBuf.byteLength > maxBytes) {
    throw new DingTalkFileDownloadError(
      `file too large after download: ${arrayBuf.byteLength} > ${maxBytes}`,
      "FILE_TOO_LARGE",
      413,
    );
  }
  return {
    buffer: Buffer.from(arrayBuf),
    filename: parseFilenameFromContentDisposition(res.headers.get("content-disposition") ?? ""),
    mimeType: res.headers.get("content-type") ?? undefined,
  };
}

async function resolveDownloadUrl(
  input: FetchDingTalkFileInput,
  fetchImpl: typeof fetch,
  timeoutMs: number,
): Promise<string> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetchImpl(DOWNLOAD_API, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-acs-dingtalk-access-token": input.accessToken,
      },
      body: JSON.stringify({
        downloadCode: input.downloadCode,
        robotCode: input.robotCode,
      }),
      signal: ctrl.signal,
    });
  } catch (err) {
    throw new DingTalkFileDownloadError(
      `resolve url failed: ${err instanceof Error ? err.message : String(err)}`,
      "RESOLVE_URL_FAILED",
    );
  } finally {
    clearTimeout(timer);
  }
  const rawText = await res.text().catch(() => "");
  let body: { downloadUrl?: string; errcode?: number; errmsg?: string; code?: string; message?: string } = {};
  try {
    if (rawText.trim()) body = JSON.parse(rawText) as typeof body;
  } catch {
    // 非 JSON 时仍用 rawText 片段帮助排障
  }
  const apiMsg = String(body.errmsg ?? body.message ?? "").trim();
  const apiCode = body.errcode ?? body.code;
  const rawSnippetFull = rawText.length > 200 ? `${rawText.slice(0, 200)}…` : rawText;
  const rawSnippetDisplay = rawSnippetFull.trim() ? rawSnippetFull : "(empty body)";
  const bits: string[] = [];
  if (apiCode !== undefined && apiCode !== null && String(apiCode) !== "") {
    bits.push(`code=${apiCode}`);
  }
  if (apiMsg) bits.push(`errmsg=${apiMsg}`);
  bits.push(`raw=${rawSnippetDisplay}`);
  const detail = ` (${bits.join(" | ")})`;
  const resolveMeta: DingTalkResolveErrorMeta = {
    httpStatus: res.status,
    apiErrcode: apiCode,
    apiErrmsg: apiMsg || undefined,
    rawSnippet: rawSnippetDisplay,
  };
  if (!res.ok || !body.downloadUrl) {
    throw new DingTalkFileDownloadError(
      `resolve url HTTP ${res.status}${detail}`,
      "RESOLVE_URL_FAILED",
      502,
      resolveMeta,
    );
  }
  return body.downloadUrl;
}

function parseFilenameFromContentDisposition(header: string): string | undefined {
  if (!header) return undefined;
  // RFC 5987 filename* 优先；回退 filename=
  const star = /filename\*=(?:UTF-8'')?([^;]+)/i.exec(header);
  if (star?.[1]) {
    try {
      return decodeURIComponent(star[1].trim().replace(/^"|"$/g, ""));
    } catch {
      // fallthrough
    }
  }
  const plain = /filename="?([^";]+)"?/i.exec(header);
  return plain?.[1]?.trim();
}
