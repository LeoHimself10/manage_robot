const URL_IN_TEXT_RE = /https?:\/\/[^\s<>"')\]]+/gi;

function normalizeExtractedUrl(raw: string): string | undefined {
  const u = raw.trim().replace(/[.,;:!?)]+$/, "");
  return u && /^https?:\/\//i.test(u) ? u : undefined;
}

function collectUrlsFromText(text: string, out: Set<string>): void {
  for (const match of text.matchAll(URL_IN_TEXT_RE)) {
    const u = normalizeExtractedUrl(match[0] ?? "");
    if (u) out.add(u);
  }
}

function collectUrlsFromRichTextSegment(segment: unknown, out: Set<string>): void {
  if (!segment || typeof segment !== "object") return;
  const obj = segment as Record<string, unknown>;
  if (typeof obj.text === "string") collectUrlsFromText(obj.text, out);
  if (typeof obj.content === "string") collectUrlsFromText(obj.content, out);
  for (const key of ["href", "url", "link", "pcUrl", "mobileUrl"] as const) {
    const v = obj[key];
    if (typeof v === "string") {
      const u = normalizeExtractedUrl(v);
      if (u) out.add(u);
    }
  }
}

function readRichTextSegments(payload: Record<string, unknown>): unknown[] {
  const top = payload.richText;
  if (Array.isArray(top)) return top;
  const content = payload.content;
  if (content && typeof content === "object" && !Array.isArray(content)) {
    const nested = (content as Record<string, unknown>).richText;
    if (Array.isArray(nested)) return nested;
  }
  return [];
}

function extractTextSegments(payload: Record<string, unknown>): string {
  const textObj = payload.text as Record<string, unknown> | undefined;
  if (typeof textObj?.content === "string" && textObj.content.trim()) {
    return textObj.content.trim();
  }
  if (typeof payload.content === "string" && payload.content.trim()) {
    return payload.content.trim();
  }

  const richText = readRichTextSegments(payload);
  if (richText.length > 0) {
    return richText
      .map((segment) => {
        if (!segment || typeof segment !== "object") return "";
        const s = segment as Record<string, unknown>;
        return typeof s.text === "string" ? s.text : typeof s.content === "string" ? s.content : "";
      })
      .join("")
      .trim();
  }

  const fallback = JSON.stringify(payload);
  if (!fallback.includes("[object Object]")) {
    return String(textObj?.content ?? "").replace(/^\[object Object\]$/, "").trim();
  }
  return "";
}

function isInternalDingtalkServiceUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === "oapi.dingtalk.com" || host === "api.dingtalk.com";
  } catch {
    return false;
  }
}

/**
 * 从钉钉 Stream 机器人回调 payload 提取用户可见文本，并附加未出现在正文中的 URL。
 */
export function extractDingtalkMessageText(payload: Record<string, unknown>): string {
  const text = extractTextSegments(payload);
  const urls = new Set<string>();
  collectUrlsFromText(text, urls);

  for (const segment of readRichTextSegments(payload)) {
    collectUrlsFromRichTextSegment(segment, urls);
  }

  for (const u of [...urls]) {
    if (isInternalDingtalkServiceUrl(u)) urls.delete(u);
  }

  const ordered = [...urls];
  if (ordered.length === 0) return text;

  const missing = ordered.filter((u) => !text.includes(u));
  if (missing.length === 0) return text;
  if (!text) return missing.join("\n");
  return `${text}\n[links]\n${missing.join("\n")}`;
}

export function extractUrlsFromText(text: string): string[] {
  const urls = new Set<string>();
  collectUrlsFromText(text, urls);
  return [...urls];
}
