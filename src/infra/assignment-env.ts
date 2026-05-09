import path from "node:path";
import { fileURLToPath } from "node:url";

export function resolveAssignmentDraftDir(): string {
  return process.env.ASSIGNMENT_DRAFT_DIR?.trim() || "./data/plans";
}

export function resolveEmployeeProfileDir(): string {
  return process.env.EMPLOYEE_PROFILE_DIR?.trim() || "./data/employees/profiles";
}

export function resolveEmployeeFixtureSourcePath(): string {
  const env = process.env.EMPLOYEE_FIXTURE_SOURCE?.trim();
  if (env) return env;
  return path.join(path.dirname(fileURLToPath(import.meta.url)), "../../fixtures/employees-seed.json");
}

export function resolveAssignmentEventsPath(): string {
  return process.env.ASSIGNMENT_EVENTS_PATH?.trim() || "./data/events/assignment-events.jsonl";
}

export function resolveCardCallbacksPath(): string {
  return process.env.CARD_CALLBACKS_PATH?.trim() || "./data/events/card-callbacks.jsonl";
}

export function resolveCardStateDir(): string {
  return process.env.CARD_STATE_DIR?.trim() || "./data/cards";
}

export function resolveAssignmentWebSecret(): string {
  const s = process.env.ASSIGNMENT_WEB_SECRET?.trim();
  if (!s) throw new Error("ASSIGNMENT_WEB_SECRET is required when assignment web UI is enabled");
  return s;
}

export function resolveAssignmentWebPort(): number {
  const n = Number(process.env.ASSIGNMENT_WEB_PORT ?? "8787");
  return Number.isFinite(n) && n > 0 ? n : 8787;
}

export function resolveAssignmentWebPublicBaseUrl(): string {
  const u = process.env.ASSIGNMENT_WEB_PUBLIC_BASE_URL?.trim();
  if (!u) throw new Error("ASSIGNMENT_WEB_PUBLIC_BASE_URL is required for DingTalk links (e.g. https://bot.example.com)");
  return u.replace(/\/$/, "");
}

export function isDingtalkAssignmentMock(): boolean {
  const v = process.env.DINGTALK_ASSIGNMENT_MOCK?.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}
