/** Parse subtask due_at TEXT for reminder eligibility (matches UI Date.parse semantics). */

export function parseDueAtMs(raw: string | undefined | null): number | undefined {
  const s = String(raw ?? "").trim();
  if (!s || s === "待确认") return undefined;
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : undefined;
}

export function isDueAtParseable(raw: string | undefined | null): boolean {
  return parseDueAtMs(raw) !== undefined;
}
