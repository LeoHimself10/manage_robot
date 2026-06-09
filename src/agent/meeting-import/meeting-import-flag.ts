/**
 * 会议入库入口开关。默认开启；设 MEETING_IMPORT_ENABLED=0 隐藏侧栏、页面与 API。
 */
export function isMeetingImportEnabled(): boolean {
  const raw = String(process.env.MEETING_IMPORT_ENABLED ?? "").trim().toLowerCase();
  if (!raw) return true;
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}
