import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { resolveWorkbenchDynamicManagersPath } from "./workbench-manager-dynamic-path";

export interface ManagerDirectoryMutation {
  before: boolean;
  after: boolean;
  changed: boolean;
}

function readManagerFile(): Set<string> {
  const file = resolveWorkbenchDynamicManagersPath();
  if (!existsSync(file)) return new Set<string>();
  try {
    const arr = JSON.parse(readFileSync(file, "utf8")) as unknown;
    if (!Array.isArray(arr)) return new Set<string>();
    return new Set(arr.map((x) => String(x).trim()).filter(Boolean));
  } catch {
    return new Set<string>();
  }
}

function saveManagerFile(ids: Set<string>): void {
  const file = resolveWorkbenchDynamicManagersPath();
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify([...ids].sort(), null, 2), "utf8");
}

export function listDynamicWorkbenchManagers(): string[] {
  return [...readManagerFile()].sort();
}

export function setDynamicWorkbenchManager(
  userId: string,
  enabled: boolean,
): ManagerDirectoryMutation {
  const normalized = String(userId ?? "").trim();
  if (!normalized) {
    throw new Error("userId is required");
  }
  const ids = readManagerFile();
  const before = ids.has(normalized);
  if (enabled) {
    ids.add(normalized);
  } else {
    ids.delete(normalized);
  }
  const after = ids.has(normalized);
  if (before !== after) {
    saveManagerFile(ids);
  }
  return { before, after, changed: before !== after };
}
