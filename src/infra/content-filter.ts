/** Redact obviously structured PII; best-effort, not exhaustive. */

const CN_MOBILE = /(?<!\d)1[3-9]\d{9}(?!\d)/g;
const CN_ID_18 = /\b\d{17}[\dXx]\b/g;
const IPV4 =
  /\b(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\b/g;

const PLACEHOLDER = "[已脱敏]";

export function redactCommonPii(markdown: string): string {
  if (process.env.CONTENT_FILTER_DISABLED === "1") {
    return markdown;
  }
  return markdown
    .replace(CN_MOBILE, PLACEHOLDER)
    .replace(CN_ID_18, PLACEHOLDER)
    .replace(IPV4, PLACEHOLDER);
}
