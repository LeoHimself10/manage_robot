import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { createPeopleDirectoryStore } from "../../src/infra/people-directory-store";

describe("people-directory-store", () => {
  let dbPath = "";

  afterEach(() => {
    if (dbPath) {
      rmSync(dbPath, { force: true });
      rmSync(`${dbPath}-shm`, { force: true });
      rmSync(`${dbPath}-wal`, { force: true });
    }
  });

  function createStore() {
    const dir = mkdtempSync(join(tmpdir(), "people-store-"));
    dbPath = join(dir, "workbench.sqlite");
    return createPeopleDirectoryStore(dbPath);
  }

  it("upserts contacts and profiles then returns merged snapshots", () => {
    const store = createStore();
    store.upsertContact({
      userId: "u1",
      name: "张三",
      departmentIds: ["10"],
      departmentNames: ["研发部"],
      position: "工程师",
      active: true,
      isAdmin: false,
      isBoss: false,
      isSenior: false,
    });
    store.upsertProfile({
      userId: "u1",
      skillTags: ["Python"],
      strengths: ["自动化"],
      boundaries: [],
      cases: [{ taskType: "build", outcome: "done" }],
      tools: ["VSCode"],
      availability: { capacityHint: "正常", emergencyOk: true },
      source: "seed",
    });

    const snapshots = store.listEmployeeSnapshots();
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].displayName).toBe("张三");
    expect(snapshots[0].department).toBe("研发部");
    expect(snapshots[0].selfProfile.skillTags).toContain("Python");
    store.close();
  });

  it("supports contact search and deactivation", () => {
    const store = createStore();
    store.upsertContact({
      userId: "u2",
      name: "李四",
      departmentIds: ["20"],
      departmentNames: ["质量部"],
      active: true,
      isAdmin: false,
      isBoss: false,
      isSenior: false,
    });
    expect(store.searchContacts("李四")).toHaveLength(1);
    store.deactivateContact("u2");
    expect(store.listEmployeeSnapshots()).toHaveLength(0);
    expect(store.listEmployeeSnapshots({ includeInactive: true })).toHaveLength(1);
    store.close();
  });
});
