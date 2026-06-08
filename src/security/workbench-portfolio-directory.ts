import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { resolveWorkbenchDynamicPortfolioManagersPath } from "./workbench-portfolio-dynamic-path";

export interface PortfolioDirectoryMutation {
  before: boolean;
  after: boolean;
  changed: boolean;
}

function readPortfolioFile(): Set<string> {
  const file = resolveWorkbenchDynamicPortfolioManagersPath();
  if (!existsSync(file)) return new Set<string>();
  try {
    const arr = JSON.parse(readFileSync(file, "utf8")) as unknown;
    if (!Array.isArray(arr)) return new Set<string>();
    return new Set(arr.map((x) => String(x).trim()).filter(Boolean));
  } catch {
    return new Set<string>();
  }
}

function savePortfolioFile(ids: Set<string>): void {
  const file = resolveWorkbenchDynamicPortfolioManagersPath();
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify([...ids].sort(), null, 2), "utf8");
}

export function listDynamicWorkbenchPortfolioManagers(): string[] {
  return [...readPortfolioFile()].sort();
}

export function setDynamicWorkbenchPortfolioManager(
  userId: string,
  enabled: boolean,
): PortfolioDirectoryMutation {
  const normalized = String(userId ?? "").trim();
  if (!normalized) {
    throw new Error("userId is required");
  }
  const ids = readPortfolioFile();
  const before = ids.has(normalized);
  if (enabled) {
    ids.add(normalized);
  } else {
    ids.delete(normalized);
  }
  const after = ids.has(normalized);
  if (before !== after) {
    savePortfolioFile(ids);
  }
  return { before, after, changed: before !== after };
}
