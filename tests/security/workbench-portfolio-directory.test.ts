import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  listDynamicWorkbenchPortfolioManagers,
  setDynamicWorkbenchPortfolioManager,
} from "../../src/security/workbench-portfolio-directory";
import { listWorkbenchProjectPortfolioUserIds } from "../../src/security/workbench-project-portfolio";

describe("workbench portfolio directory", () => {
  let tempDir = "";

  afterEach(() => {
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
    tempDir = "";
    vi.unstubAllEnvs();
  });

  it("merges env and dynamic portfolio manager ids", () => {
    tempDir = mkdtempSync(join(tmpdir(), "portfolio-dir-"));
    const dynamicFile = join(tempDir, "portfolio-managers.json");
    writeFileSync(dynamicFile, JSON.stringify(["dynamic-user"]), "utf8");
    vi.stubEnv("WORKBENCH_PROJECT_PORTFOLIO_USER_IDS", "env-user");
    vi.stubEnv("WORKBENCH_DYNAMIC_PORTFOLIO_IDS_FILE", dynamicFile);

    expect([...listWorkbenchProjectPortfolioUserIds()].sort()).toEqual([
      "dynamic-user",
      "env-user",
    ]);
  });

  it("setDynamicWorkbenchPortfolioManager toggles membership", () => {
    tempDir = mkdtempSync(join(tmpdir(), "portfolio-dir-"));
    const dynamicFile = join(tempDir, "portfolio-managers.json");
    vi.stubEnv("WORKBENCH_DYNAMIC_PORTFOLIO_IDS_FILE", dynamicFile);

    const grant = setDynamicWorkbenchPortfolioManager("u1", true);
    expect(grant).toEqual({ before: false, after: true, changed: true });
    expect(listDynamicWorkbenchPortfolioManagers()).toEqual(["u1"]);

    const revoke = setDynamicWorkbenchPortfolioManager("u1", false);
    expect(revoke).toEqual({ before: true, after: false, changed: true });
    expect(listDynamicWorkbenchPortfolioManagers()).toEqual([]);
  });
});
