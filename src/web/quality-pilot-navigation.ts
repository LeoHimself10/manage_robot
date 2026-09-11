export const QUALITY_PILOT_PREFIX = "/workbench/quality-pilot";

/** Only the separately configured pilot accepts these login destinations. */
export function sanitizeQualityPilotNextPath(
  raw: string,
  isWorkbenchPage: (pathname: string) => boolean,
  enabled = Boolean(process.env.QUALITY_PILOT_BUSINESS_USER_ID?.trim()),
): string | undefined {
  if (!enabled || !raw.startsWith(QUALITY_PILOT_PREFIX + "/")
    || /[\\\r\n]/.test(raw)) return undefined;
  try {
    const url = new URL(raw, "https://quality.invalid");
    if (url.origin !== "https://quality.invalid") return undefined;
    const path = url.pathname.slice(QUALITY_PILOT_PREFIX.length);
    if (!["/", "/ma-workbench/", "/tong/"].includes(path)
      && !isWorkbenchPage(path)) return undefined;
    if (url.searchParams.has("testActor") || url.searchParams.has("managerUserId")) return undefined;
    return url.pathname + url.search + url.hash;
  } catch { return undefined; }
}
