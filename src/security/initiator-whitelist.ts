import { readFileSync, existsSync } from "node:fs";

export function isTaskInitiatorAllowed(userId: string): boolean {
  const file = process.env.TASK_INITIATOR_IDS_FILE?.trim();
  if (file && existsSync(file)) {
    const arr = JSON.parse(readFileSync(file, "utf8")) as unknown;
    if (Array.isArray(arr)) {
      return arr.map(String).includes(userId);
    }
  }
  const raw = process.env.TASK_INITIATOR_USER_IDS?.trim();
  if (!raw) return true; // empty env => allow all (dev-friendly)
  const allow = new Set(
    raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
  );
  return allow.has(userId);
}
