import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  addProjectViewRosterMember,
  createProjectViewRosterStore,
  listProjectViewRoster,
  removeProjectViewRosterMember,
} from "../../../src/agent/daily-report-digest/daily-report-project-view-roster-store";

describe("daily-report-project-view-roster-store", () => {
  let dbPath = "";

  afterEach(() => {
    if (dbPath) {
      rmSync(dbPath, { force: true });
      rmSync(`${dbPath}-shm`, { force: true });
      rmSync(`${dbPath}-wal`, { force: true });
    }
  });

  function createStore() {
    const dir = mkdtempSync(join(tmpdir(), "project-view-roster-"));
    dbPath = join(dir, "workbench.sqlite");
    return createProjectViewRosterStore(dbPath);
  }

  it("adds and lists members idempotently", () => {
    const store = createStore();
    const viewId = "vein-laser";

    addProjectViewRosterMember(
      viewId,
      { userid: "u1", name: "Alice", source: "manual" },
      store,
    );
    addProjectViewRosterMember(
      viewId,
      { userid: "u2", name: "Bob", source: "discovery" },
      store,
    );
    addProjectViewRosterMember(
      viewId,
      { userid: "u1", name: "Alice", source: "manual" },
      store,
    );

    const members = listProjectViewRoster(viewId, store);
    expect(members).toHaveLength(2);
    expect(members.map((m) => m.userid).sort()).toEqual(["u1", "u2"]);
    expect(members.find((m) => m.userid === "u1")?.name).toBe("Alice");
    expect(members.find((m) => m.userid === "u1")?.source).toBe("manual");
    expect(members.find((m) => m.userid === "u2")?.source).toBe("discovery");
    store.close();
  });

  it("removes a member", () => {
    const store = createStore();
    const viewId = "vein-laser";

    addProjectViewRosterMember(viewId, { userid: "u1", name: "Alice" }, store);
    addProjectViewRosterMember(viewId, { userid: "u2", name: "Bob" }, store);

    removeProjectViewRosterMember(viewId, "u1", store);

    const members = listProjectViewRoster(viewId, store);
    expect(members).toHaveLength(1);
    expect(members[0].userid).toBe("u2");
    store.close();
  });
});
