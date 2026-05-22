/** Upsert assignment rows by taskId without dropping unrelated rows. */

export function mergeAssignmentRows(
  existing: Record<string, unknown> | undefined,
  incoming: Record<string, unknown>,
): Record<string, unknown> {
  const existingRows = Array.isArray(
    (existing as { assignments?: unknown[] } | undefined)?.assignments,
  )
    ? ([...(existing as { assignments: Array<Record<string, unknown>> }).assignments])
    : [];
  const incomingRows = Array.isArray(
    (incoming as { assignments?: unknown[] }).assignments,
  )
    ? (incoming as { assignments: Array<Record<string, unknown>> }).assignments
    : [];

  const byTaskId = new Map<string, Record<string, unknown>>();
  for (const row of existingRows) {
    const id = String(row?.taskId ?? "").trim();
    if (id) byTaskId.set(id, { ...row });
  }
  for (const row of incomingRows) {
    const id = String(row?.taskId ?? "").trim();
    if (!id) continue;
    const prev = byTaskId.get(id);
    if (prev) {
      const prevPrimary = (prev.primary as Record<string, unknown> | undefined) ?? {};
      const nextPrimary = (row.primary as Record<string, unknown> | undefined) ?? {};
      byTaskId.set(id, {
        ...prev,
        ...row,
        primary: { ...prevPrimary, ...nextPrimary },
      });
    } else {
      byTaskId.set(id, { ...row });
    }
  }

  return {
    ...(existing ?? {}),
    ...incoming,
    assignments: [...byTaskId.values()],
  };
}

export function getAssignmentCoverage(
  draft: Record<string, unknown> | undefined,
  assignment: Record<string, unknown> | undefined,
): { total: number; covered: number; missingTaskIds: string[] } {
  const tasks = Array.isArray((draft as { tasks?: unknown[] } | undefined)?.tasks)
    ? ((draft as { tasks: Array<Record<string, unknown>> }).tasks)
    : [];
  const taskIds = tasks
    .map((t) => String(t?.id ?? "").trim())
    .filter(Boolean);
  const rows = Array.isArray((assignment as { assignments?: unknown[] } | undefined)?.assignments)
    ? ((assignment as { assignments: Array<Record<string, unknown>> }).assignments)
    : [];
  const assigned = new Set<string>();
  for (const row of rows) {
    const taskId = String(row?.taskId ?? "").trim();
    if (!taskId) continue;
    const primary = row.primary as Record<string, unknown> | undefined;
    const userId = String(primary?.userId ?? "").trim();
    if (userId) assigned.add(taskId);
  }
  const missingTaskIds = taskIds.filter((id) => !assigned.has(id));
  return {
    total: taskIds.length,
    covered: taskIds.length - missingTaskIds.length,
    missingTaskIds,
  };
}
