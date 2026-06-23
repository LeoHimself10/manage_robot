import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { parseDailyReportDigestConfig } from "../../../src/agent/daily-report-digest/daily-report-config";
import { addProjectViewRosterMember, createProjectViewRosterStore } from "../../../src/agent/daily-report-digest/daily-report-project-view-roster-store";
import {
  findOrgsForEvalUser,
  isUserInEvalRoster,
  loadEvalRosterUserIds,
} from "../../../src/agent/competency-eval/eval-roster";

const MOCK_CONFIG = parseDailyReportDigestConfig({
  orgs: [
    {
      label: "明思",
      appKey: "ak1",
      appSecret: "as1",
      employees: [
        { userid: "u_a", name: "张三" },
        { userid: "u_b", name: "李四" },
      ],
    },
    {
      label: "微光",
      appKey: "ak2",
      appSecret: "as2",
      employees: [{ userid: "u_c", name: "王五" }],
    },
  ],
}).config;

describe("eval-roster", () => {
  let tmpDir = "";
  let dbPath = "";

  function useEmptyWorkbenchDb() {
    tmpDir = mkdtempSync(join(tmpdir(), "eval-roster-"));
    dbPath = join(tmpDir, "workbench.sqlite");
    process.env.WORKBENCH_SQLITE_PATH = dbPath;
  }

  function cleanupDb() {
    delete process.env.WORKBENCH_SQLITE_PATH;
    if (dbPath) {
      rmSync(dbPath, { force: true });
      rmSync(`${dbPath}-shm`, { force: true });
      rmSync(`${dbPath}-wal`, { force: true });
    }
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
    tmpDir = "";
    dbPath = "";
  }

  it("unions employees from all orgs", () => {
    useEmptyWorkbenchDb();
    try {
      expect(loadEvalRosterUserIds(MOCK_CONFIG).sort()).toEqual(["u_a", "u_b", "u_c"]);
    } finally {
      cleanupDb();
    }
  });

  it("isUserInEvalRoster checks membership", () => {
    useEmptyWorkbenchDb();
    try {
      expect(isUserInEvalRoster("u_a", MOCK_CONFIG)).toBe(true);
      expect(isUserInEvalRoster("u_c", MOCK_CONFIG)).toBe(true);
      expect(isUserInEvalRoster("unknown", MOCK_CONFIG)).toBe(false);
      expect(isUserInEvalRoster("", MOCK_CONFIG)).toBe(false);
    } finally {
      cleanupDb();
    }
  });

  it("includes project view roster members (managebot)", () => {
    useEmptyWorkbenchDb();
    const store = createProjectViewRosterStore(dbPath);
    addProjectViewRosterMember(
      "semiconductor-vein",
      { userid: "pv_u1", name: "项目组员", source: "manual" },
      store,
    );
    store.close();

    const cfg = parseDailyReportDigestConfig({
    orgs: [
      {
        label: "微光",
        appKey: "ak",
        appSecret: "as",
        employees: [],
        projectViews: [
          {
            id: "semiconductor-vein",
            label: "半导体激光·静脉项目",
            viewers: ["01451725613871"],
            filters: {
              workModuleContains: "半导体激光",
              costProjectContains: "静脉",
            },
          },
        ],
      },
    ],
  }).config;

    try {
      expect(isUserInEvalRoster("pv_u1", cfg)).toBe(true);
      expect(findOrgsForEvalUser("pv_u1", cfg).map((o) => o.label)).toEqual(["微光"]);
    } finally {
      cleanupDb();
    }
  });
});
