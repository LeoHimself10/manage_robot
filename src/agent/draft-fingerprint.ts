/** Stable fingerprint for draft task identity across REDRAFT / split. */

export function fingerprintTask(task: Record<string, unknown>): string {
  const title = String(task?.title ?? "").trim().toLowerCase();
  const objective = String(task?.objective ?? "").trim().toLowerCase();
  return `${title}::${objective}`;
}
