import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { afterEach, describe, expect, it } from "vitest";
import { createEmployeeProfileRepo } from "../../src/integrations/repos/employee-profile-repo";

describe("employee-profile-repo", () => {
  let dir: string;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it("list returns all profiles in directory", () => {
    dir = mkdtempSync(join(tmpdir(), "emp-test-"));
    writeFileSync(join(dir, "u1.json"), JSON.stringify({ userId: "u1" }));
    writeFileSync(join(dir, "u2.json"), JSON.stringify({ userId: "u2" }));
    const repo = createEmployeeProfileRepo(dir);
    expect(repo.list()).toHaveLength(2);
  });

  it("get returns profile by userId", () => {
    dir = mkdtempSync(join(tmpdir(), "emp-test-"));
    writeFileSync(join(dir, "u1.json"), JSON.stringify({ userId: "u1", displayName: "张三" }));
    const repo = createEmployeeProfileRepo(dir);
    expect(repo.get("u1")?.displayName).toBe("张三");
  });

  it("get returns undefined for missing userId", () => {
    dir = mkdtempSync(join(tmpdir(), "emp-test-"));
    const repo = createEmployeeProfileRepo(dir);
    expect(repo.get("nonexistent")).toBeUndefined();
  });
});
