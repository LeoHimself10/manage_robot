import { validateUrlForFetch } from "../../security/url-fetch-guard";

export const DINGTALK_DOC_FALLBACK_HINT =
  "该链接可能需要登录（常见于钉钉文档/钉盘）。请复制文档关键段落粘贴到对话，或导出 PDF/Word 后在单聊中发送文件/粘贴文字。";

const LOGIN_WALL_RE =
  /(?:登录|登入|sign[\s-]?in|log[\s-]?in|请先登录|需要登录|扫码登录|钉钉文档|alidocs|auth)/i;

const DEFAULT_TIMEOUT_MS = 12_000;
const DEFAULT_MAX_BYTES = 512 * 1024;
const DEFAULT_MAX_TEXT_CHARS = 12_000;
const DEFAULT_MAX_REDIRECTS = 5;

export type FetchUrlContentInput = {
  url: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxBytes?: number;
  maxTextChars?: number;
  maxRedirects?: number;
};

export type FetchUrlContentSuccess = {
  ok: true;
  url: string;
  finalUrl?: string;
  title?: string;
  text: string;
  chars: number;
  truncated?: boolean;
  note?: string;
};

export type FetchUrlContentFailure = {
  ok: false;
  reason:
    | "invalid_url"
    | "blocked_protocol"
    | "blocked_host"
    | "blocked_ip"
    | "host_not_allowed"
    | "fetch_failed"
    | "http_error"
    | "timeout"
    | "file_too_large"
    | "unsupported_content_type"
    | "login_wall_or_empty"
    | "empty_content";
  hint: string;
  url: string;
  httpStatus?: number;
};

export type FetchUrlContentResult = FetchUrlContentSuccess | FetchUrlContentFailure;

function readEnvInt(name: string, fallback: number, min: number, max: number): number {
  const raw = Number(process.env[name]?.trim());
  if (!Number.isFinite(raw)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(raw)));
}

export function htmlToPlainText(html: string): string {
  let text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h[1-6]|li|tr|section|article|header|footer)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
  text = text.replace(/\r\n/g, "\n").replace(/[ \t]+\n/g, "\n");
  text = text.replace(/[ \t]{2,}/g, " ");
  text = text.replace(/\n{3,}/g, "\n\n");
  return text.trim();
}

function extractHtmlTitle(html: string): string | undefined {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!match?.[1]) return undefined;
  return htmlToPlainText(match[1]).slice(0, 200) || undefined;
}

function isDingtalkDocHost(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  return lower.includes("dingtalk.com") || lower.includes("alidocs");
}

function looksLikeLoginWall(text: string, hostname: string): boolean {
  if (text.length >= 400) return false;
  if (LOGIN_WALL_RE.test(text)) return true;
  if (isDingtalkDocHost(hostname) && text.length < 300) return true;
  return false;
}

async function readResponseBodyLimited(
  response: Response,
  maxBytes: number,
): Promise<{ ok: true; buffer: Buffer } | { ok: false; reason: "file_too_large" }> {
  if (!response.body) {
    const arr = Buffer.from(await response.arrayBuffer());
    if (arr.byteLength > maxBytes) return { ok: false, reason: "file_too_large" };
    return { ok: true, buffer: arr };
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      return { ok: false, reason: "file_too_large" };
    }
    chunks.push(value);
  }
  return { ok: true, buffer: Buffer.concat(chunks) };
}

async function fetchWithRedirects(
  startUrl: URL,
  options: {
    fetchImpl: typeof fetch;
    timeoutMs: number;
    maxBytes: number;
    maxRedirects: number;
  },
): Promise<
  | { ok: true; response: Response; finalUrl: string }
  | { ok: false; reason: FetchUrlContentFailure["reason"]; hint: string; httpStatus?: number }
> {
  let current = startUrl;
  for (let i = 0; i <= options.maxRedirects; i += 1) {
    const guard = await validateUrlForFetch(current.toString());
    if (!guard.ok) {
      return { ok: false, reason: guard.reason, hint: guard.hint };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs);
    let response: Response;
    try {
      response = await options.fetchImpl(current.toString(), {
        method: "GET",
        redirect: "manual",
        signal: controller.signal,
        headers: {
          Accept: "text/html,application/json,text/plain;q=0.9,*/*;q=0.8",
          "User-Agent": "manage-robot-read-url/1.0",
        },
      });
    } catch (err) {
      clearTimeout(timer);
      if (err instanceof Error && err.name === "AbortError") {
        return { ok: false, reason: "timeout", hint: `读取超时（>${options.timeoutMs}ms），请粘贴关键内容。` };
      }
      return {
        ok: false,
        reason: "fetch_failed",
        hint: `网络请求失败：${err instanceof Error ? err.message : String(err)}`,
      };
    } finally {
      clearTimeout(timer);
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) {
        return {
          ok: false,
          reason: "http_error",
          hint: `HTTP ${response.status}，缺少重定向地址。`,
          httpStatus: response.status,
        };
      }
      current = new URL(location, current);
      continue;
    }

    if (!response.ok) {
      return {
        ok: false,
        reason: "http_error",
        hint: `HTTP ${response.status}，无法读取页面正文。`,
        httpStatus: response.status,
      };
    }

    return { ok: true, response, finalUrl: current.toString() };
  }

  return {
    ok: false,
    reason: "fetch_failed",
    hint: `重定向次数超过 ${options.maxRedirects} 次。`,
  };
}

export async function fetchUrlContent(input: FetchUrlContentInput): Promise<FetchUrlContentResult> {
  const url = String(input.url ?? "").trim();
  const guard = await validateUrlForFetch(url);
  if (!guard.ok) {
    return { ok: false, reason: guard.reason, hint: guard.hint, url };
  }

  const fetchImpl = input.fetchImpl ?? fetch;
  const timeoutMs = input.timeoutMs ?? readEnvInt("READ_URL_TIMEOUT_MS", DEFAULT_TIMEOUT_MS, 1000, 60000);
  const maxBytes = input.maxBytes ?? readEnvInt("READ_URL_MAX_BYTES", DEFAULT_MAX_BYTES, 4096, 4 * 1024 * 1024);
  const maxTextChars =
    input.maxTextChars ?? readEnvInt("READ_URL_MAX_TEXT_CHARS", DEFAULT_MAX_TEXT_CHARS, 500, 100_000);
  const maxRedirects = input.maxRedirects ?? DEFAULT_MAX_REDIRECTS;

  const fetched = await fetchWithRedirects(guard.url, {
    fetchImpl,
    timeoutMs,
    maxBytes,
    maxRedirects,
  });
  if (!fetched.ok) {
    return { ok: false, reason: fetched.reason, hint: fetched.hint, url, httpStatus: fetched.httpStatus };
  }

  const bodyRead = await readResponseBodyLimited(fetched.response, maxBytes);
  if (!bodyRead.ok) {
    return {
      ok: false,
      reason: "file_too_large",
      hint: `页面体积超过 ${maxBytes} 字节，请粘贴关键段落。`,
      url,
    };
  }

  const contentType = String(fetched.response.headers.get("content-type") ?? "").toLowerCase();
  const hostname = guard.url.hostname;
  let text = "";
  let title: string | undefined;

  if (contentType.includes("text/html") || bodyRead.buffer.slice(0, 15).toString("utf8").includes("<html")) {
    const html = bodyRead.buffer.toString("utf8");
    title = extractHtmlTitle(html);
    text = htmlToPlainText(html);
  } else if (contentType.includes("application/json") || contentType.includes("text/plain")) {
    text = bodyRead.buffer.toString("utf8").trim();
    if (contentType.includes("application/json")) {
      try {
        text = JSON.stringify(JSON.parse(text), null, 2);
      } catch {
        // keep raw text
      }
    }
  } else {
    return {
      ok: false,
      reason: "unsupported_content_type",
      hint: `不支持的内容类型（${contentType || "unknown"}），请粘贴关键文字或导出为 PDF/Word。`,
      url,
    };
  }

  if (!text) {
    return {
      ok: false,
      reason: "empty_content",
      hint: "页面正文为空。请粘贴文档关键内容。",
      url,
    };
  }

  if (looksLikeLoginWall(text, hostname)) {
    const hint = isDingtalkDocHost(hostname)
      ? DINGTALK_DOC_FALLBACK_HINT
      : "该页面可能需要登录或正文过少。请粘贴文档关键段落。";
    return {
      ok: false,
      reason: "login_wall_or_empty",
      hint,
      url,
    };
  }

  const truncated = text.length > maxTextChars;
  if (truncated) {
    text = text.slice(0, maxTextChars);
  }

  return {
    ok: true,
    url,
    finalUrl: fetched.finalUrl !== url ? fetched.finalUrl : undefined,
    title,
    text,
    chars: text.length,
    truncated: truncated || undefined,
    note: truncated ? `正文已截断至 ${maxTextChars} 字符。` : undefined,
  };
}
