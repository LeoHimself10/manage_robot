import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isWorkbenchManager } from "../../src/security/workbench-manager-whitelist";

describe("isWorkbenchManager", () => {
  let tmpFile: string | undefined;
  let dynamicFile: string | undefined;

  beforeEach(() => {
    vi.unstubAllEnvs();
    tmpFile = undefined;
    dynamicFile = join(tmpdir(), `test-workbench-managers-dynamic-${Date.now()}.json`);
    vi.stubEnv("WORKBENCH_DYNAMIC_MANAGER_IDS_FILE", dynamicFile);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    if (tmpFile) {
      try {
        unlinkSync(tmpFile);
      } catch {
        /* ok */
      }
    }
  });

  it("denies everyone when no env is set (reserve until configured)", () => {
    expect(isWorkbenchManager("anyone")).toBe(false);
    expect(isWorkbenchManager("someone-else")).toBe(false);
  });

  it("allows listed ids and denies unlisted ones via WORKBENCH_MANAGER_USER_IDS", () => {
    vi.stubEnv("WORKBENCH_MANAGER_USER_IDS", "a,b");
    expect(isWorkbenchManager("a")).toBe(true);
    expect(isWorkbenchManager("b")).toBe(true);
    expect(isWorkbenchManager("c")).toBe(false);
  });

  it("trims whitespace in WORKBENCH_MANAGER_USER_IDS values", () => {
    vi.stubEnv("WORKBENCH_MANAGER_USER_IDS", " a , b ,  c ");
    expect(isWorkbenchManager("a")).toBe(true);
    expect(isWorkbenchManager("b")).toBe(true);
    expect(isWorkbenchManager("c")).toBe(true);
    expect(isWorkbenchManager(" d ")).toBe(false);
  });

  it("reads manager ids from WORKBENCH_MANAGER_IDS_FILE", () => {
    tmpFile = join(tmpdir(), `test-workbench-managers-${Date.now()}.json`);
    writeFileSync(tmpFile, JSON.stringify(["x"]), "utf8");

    vi.stubEnv("WORKBENCH_MANAGER_IDS_FILE", tmpFile);
    vi.stubEnv("WORKBENCH_MANAGER_USER_IDS", "");
    expect(isWorkbenchManager("x")).toBe(true);
    expect(isWorkbenchManager("y")).toBe(false);
  });

  it("prefers file list when both file and env are set", () => {
    tmpFile = join(tmpdir(), `test-workbench-managers-${Date.now()}.json`);
    writeFileSync(tmpFile, JSON.stringify(["from-file"]), "utf8");

    vi.stubEnv("WORKBENCH_MANAGER_IDS_FILE", tmpFile);
    vi.stubEnv("WORKBENCH_MANAGER_USER_IDS", "from-env,other");
    expect(isWorkbenchManager("from-file")).toBe(true);
    expect(isWorkbenchManager("from-env")).toBe(true);
  });

  it("includes dynamic manager ids from admin-managed file", () => {
    if (!dynamicFile) throw new Error("missing dynamic file");
    writeFileSync(dynamicFile, JSON.stringify(["dynamic-1"]), "utf8");
    expect(isWorkbenchManager("dynamic-1")).toBe(true);
  });

  it("treats empty WORKBENCH_MANAGER_USER_IDS as no managers when file absent", () => {
    vi.stubEnv("WORKBENCH_MANAGER_USER_IDS", "");
    expect(isWorkbenchManager("anyone")).toBe(false);
  });

  it("includes manager group members when manager groups are enabled", async () => {
    const { addWorkbenchManagerGroupMember, createWorkbenchManagerGroup } = await import(
      "../../src/security/workbench-manager-groups"
    );
    const groupFile = join(tmpdir(), `test-workbench-manager-groups-${Date.now()}.json`);
    vi.stubEnv("WORKBENCH_MANAGER_GROUPS_ENABLED", "1");
    vi.stubEnv("WORKBENCH_MANAGER_GROUPS_FILE", groupFile);
    vi.stubEnv("WORKBENCH_MANAGER_USER_IDS", "");

    const group = createWorkbenchManagerGroup({ name: "Mingsi project managers" });
    addWorkbenchManagerGroupMember(group.groupId, "group-mgr");

    expect(isWorkbenchManager("group-mgr")).toBe(true);
  });
});
