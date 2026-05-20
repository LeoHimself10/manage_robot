import type { PlanSession } from "../infra/plan-session-store";

export interface EmployeeSearchHit {
  userId: string;
  displayName: string;
  department?: string;
  hitAt: string;
}

const HIT_TTL_MS = 60 * 60 * 1000;

function parseUserIdFromSearchBlock(block: string): string | undefined {
  const userIdLine = block.match(/userId:\s*(\S+)/);
  if (userIdLine?.[1]) return userIdLine[1].trim();
  const idEq = block.match(/id=(\S+)/);
  return idEq?.[1]?.trim();
}

function parseDisplayNameFromSearchBlock(block: string): string | undefined {
  const dn = block.match(/displayName:\s*(.+)/);
  if (dn?.[1]) return dn[1].trim();
  const nameEq = block.match(/name=([^|\n]+)/);
  return nameEq?.[1]?.trim();
}

function pruneExpiredHits(session: PlanSession): void {
  if (!session.lastEmployeeSearchHits?.length) return;
  const cutoff = Date.now() - HIT_TTL_MS;
  session.lastEmployeeSearchHits = session.lastEmployeeSearchHits.filter(
    (h) => Date.parse(h.hitAt) >= cutoff,
  );
}

export function mergeCandidatePoolIntoSearchHits(session: PlanSession): void {
  const pool = session.candidatePool?.entries ?? [];
  if (pool.length === 0) return;
  if (!session.lastEmployeeSearchHits) session.lastEmployeeSearchHits = [];
  const now = new Date().toISOString();
  for (const entry of pool) {
    const userId = String(entry.userId ?? "").trim();
    if (!userId) continue;
    const idx = session.lastEmployeeSearchHits.findIndex((h) => h.userId === userId);
    const hit: EmployeeSearchHit = {
      userId,
      displayName: String(entry.displayName ?? userId).trim(),
      hitAt: now,
    };
    if (idx >= 0) session.lastEmployeeSearchHits[idx] = hit;
    else session.lastEmployeeSearchHits.push(hit);
  }
}

export function recordSearchHitsFromCandidates(
  session: PlanSession,
  candidates: string[],
  getContact?: (userId: string) => { name?: string; departmentNames?: string[] } | undefined,
): void {
  if (!session.lastEmployeeSearchHits) session.lastEmployeeSearchHits = [];
  const now = new Date().toISOString();
  for (const block of candidates) {
    const userId = parseUserIdFromSearchBlock(block);
    if (!userId) continue;
    const displayName =
      parseDisplayNameFromSearchBlock(block)
      || getContact?.(userId)?.name?.trim()
      || userId;
    const department = getContact?.(userId)?.departmentNames?.[0];
    const idx = session.lastEmployeeSearchHits.findIndex((h) => h.userId === userId);
    const hit: EmployeeSearchHit = { userId, displayName, department, hitAt: now };
    if (idx >= 0) session.lastEmployeeSearchHits[idx] = hit;
    else session.lastEmployeeSearchHits.push(hit);
  }
  mergeCandidatePoolIntoSearchHits(session);
}

export function clearEmployeeSearchHits(session: PlanSession): void {
  session.lastEmployeeSearchHits = [];
}

export function getEmployeeSearchHit(
  session: PlanSession,
  userId: string,
): EmployeeSearchHit | undefined {
  pruneExpiredHits(session);
  mergeCandidatePoolIntoSearchHits(session);
  return session.lastEmployeeSearchHits?.find((h) => h.userId === userId);
}

export function isUserIdAllowedForAssignment(session: PlanSession, userId: string): boolean {
  return getEmployeeSearchHit(session, userId) !== undefined;
}

/** Resolve collaborator token (displayName or userId) to a search-hit userId. */
export function resolveCollaboratorToken(
  session: PlanSession,
  token: string,
): { userId: string; displayName: string } | undefined {
  const trimmed = String(token ?? "").trim();
  if (!trimmed) return undefined;
  pruneExpiredHits(session);
  mergeCandidatePoolIntoSearchHits(session);
  const hits = session.lastEmployeeSearchHits ?? [];
  const byId = hits.find((h) => h.userId === trimmed);
  if (byId) return { userId: byId.userId, displayName: byId.displayName };
  const byName = hits.find((h) => h.displayName === trimmed || h.displayName.includes(trimmed));
  if (byName) return { userId: byName.userId, displayName: byName.displayName };
  return undefined;
}

/** Reject raw numeric-looking userIds in collaborator lists unless they are search hits. */
export function isRawUserIdToken(token: string): boolean {
  return /^\d{10,}$/.test(String(token ?? "").trim());
}
