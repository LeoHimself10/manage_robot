import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEmployeeProfileRepo } from "../../src/integrations/repos/employee-profile-repo";
import { createPeopleDirectoryStore } from "../../src/infra/people-directory-store";

describe("employee-profile-repo", () => {
  let dir: string;
  let dbPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "emp-test-"));
    dbPath = join(dir, "workbench.sqlite");
    vi.stubEnv("WORKBENCH_SQLITE_PATH", dbPath);
  });

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    vi.unstubAllEnvs();
  });

  it("list returns active profiles from sqlite snapshots", () => {
    const store = createPeopleDirectoryStore();
    store.upsertContact({
      userId: "u1",
      name: "张三",
      departmentIds: ["1"],
      departmentNames: ["研发部"],
      position: "工程师",
      active: true,
      isAdmin: false,
      isBoss: false,
      isSenior: false,
    });
    store.upsertContact({
      userId: "u2",
      name: "李四",
      departmentIds: ["2"],
      departmentNames: ["质量部"],
      position: "工程师",
      active: false,
      isAdmin: false,
      isBoss: false,
      isSenior: false,
    });
    store.upsertProfile({
      userId: "u1",
      skillTags: ["Python"],
      strengths: [],
      boundaries: [],
      cases: [],
      tools: [],
      availability: {},
    });
    store.close();
    const repo = createEmployeeProfileRepo();
    expect(repo.list()).toHaveLength(1);
  });

  it("get returns profile by userId", () => {
    const store = createPeopleDirectoryStore();
    store.upsertContact({
      userId: "u1",
      name: "张三",
      departmentIds: ["1"],
      departmentNames: ["研发部"],
      position: "工程师",
      active: true,
      isAdmin: false,
      isBoss: false,
      isSenior: false,
    });
    store.close();
    const repo = createEmployeeProfileRepo();
    expect(repo.get("u1")?.displayName).toBe("张三");
  });

  it("get returns undefined for missing userId", () => {
    const repo = createEmployeeProfileRepo();
    expect(repo.get("nonexistent")).toBeUndefined();
  });
});
