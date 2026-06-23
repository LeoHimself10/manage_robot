import { existsSync, readFileSync } from "node:fs";

function parseIds(raw: string): string[] {
  return raw
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function listCompetencyEvalUserIds(): string[] {
  const fromEnv = parseIds(process.env.COMPETENCY_EVAL_USER_IDS ?? "");
  const file = String(process.env.COMPETENCY_EVAL_USER_IDS_FILE ?? "").trim();
  if (!file || !existsSync(file)) return [...new Set(fromEnv)];
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    const fromFile = Array.isArray(parsed) ? parsed.map(String) : [];
    return [...new Set([...fromEnv, ...fromFile.map((s) => s.trim()).filter(Boolean)])];
  } catch {
    return [...new Set(fromEnv)];
  }
}

export function isCompetencyEvalUser(userId: string): boolean {
  const id = String(userId ?? "").trim();
  if (!id) return false;
  return listCompetencyEvalUserIds().includes(id);
}
