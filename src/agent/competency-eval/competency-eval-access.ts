import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { resolveCompetencyEvalDataDir } from "./competency-eval-session-store";

export interface CompetencyEvalAccessMutation {
  before: boolean;
  after: boolean;
  changed: boolean;
}

function parseIds(raw: string): string[] {
  return raw
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function uniqueIds(ids: string[]): string[] {
  return [...new Set(ids.map((id) => id.trim()).filter(Boolean))].sort();
}

function readIdsFile(file: string): string[] | undefined {
  if (!file || !existsSync(file)) return undefined;
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as unknown;
    if (!Array.isArray(parsed)) return undefined;
    return uniqueIds(parsed.map(String));
  } catch {
    return undefined;
  }
}

function listConfiguredCompetencyEvalUserIds(): string[] {
  const fromEnv = parseIds(process.env.COMPETENCY_EVAL_USER_IDS ?? "");
  const file = String(process.env.COMPETENCY_EVAL_USER_IDS_FILE ?? "").trim();
  return uniqueIds([...fromEnv, ...(readIdsFile(file) ?? [])]);
}

export function resolveCompetencyEvalManagedUserIdsPath(): string {
  return (
    String(process.env.COMPETENCY_EVAL_MANAGED_USER_IDS_FILE ?? "").trim() ||
    join(resolveCompetencyEvalDataDir(), "access-users.json")
  );
}

export function listManagedCompetencyEvalUserIds(): string[] | undefined {
  const file = resolveCompetencyEvalManagedUserIdsPath();
  if (!existsSync(file)) return undefined;
  // A damaged managed file must not silently restore broader legacy access.
  return readIdsFile(file) ?? [];
}

export function listCompetencyEvalUserIds(): string[] {
  // Once an admin has used the permission center, its persisted selection is
  // authoritative. Before that first edit, retain the legacy env/file list.
  return listManagedCompetencyEvalUserIds() ?? listConfiguredCompetencyEvalUserIds();
}

function saveManagedCompetencyEvalUserIds(ids: Set<string>): void {
  const file = resolveCompetencyEvalManagedUserIdsPath();
  mkdirSync(dirname(file), { recursive: true });
  const tempFile = `${file}.${process.pid}.tmp`;
  writeFileSync(tempFile, JSON.stringify([...ids].sort(), null, 2), "utf8");
  renameSync(tempFile, file);
}

export function setCompetencyEvalUser(
  userId: string,
  enabled: boolean,
): CompetencyEvalAccessMutation {
  const normalized = String(userId ?? "").trim();
  if (!normalized) throw new Error("userId is required");

  const ids = new Set(
    listManagedCompetencyEvalUserIds() ?? listConfiguredCompetencyEvalUserIds(),
  );
  const before = ids.has(normalized);
  if (enabled) ids.add(normalized);
  else ids.delete(normalized);
  const after = ids.has(normalized);

  // Persist even for a no-op first edit so future env changes cannot silently
  // override the list the administrator has taken ownership of.
  saveManagedCompetencyEvalUserIds(ids);
  return { before, after, changed: before !== after };
}

export function isCompetencyEvalUser(userId: string): boolean {
  const id = String(userId ?? "").trim();
  if (!id) return false;
  return listCompetencyEvalUserIds().includes(id);
}
