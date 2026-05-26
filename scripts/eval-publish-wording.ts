/**
 * Eval helper: detect assistant message still using legacy 「发布」 product wording.
 * Tool names (prepare_publish_task) must not appear in user-visible message per prompt discipline.
 */
export function assistantUsesPublishWording(text: string): boolean {
  const t = String(text ?? "").trim();
  if (!t) return false;
  return /(?:已|正式)?发布|已发布并|发布前|发布后|发布成功|正式发布|尚未发布|未发布草案|可发布|确认发布/.test(t);
}

/** Prefer 发放 wording on successful publish turn (informational only). */
export function assistantUsesDispatchWording(text: string): boolean {
  const t = String(text ?? "").trim();
  if (!t) return false;
  return /已发放|正式发放|发放成功|待员工承接|待承接/.test(t);
}
