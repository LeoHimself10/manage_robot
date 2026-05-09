import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { createEmployeeProfileRepo } from "../../src/integrations/repos/employee-profile-repo";

describe("employee-profile-repo", () => {
  it("list returns all profiles in directory", () => {
    const dir = mkdtempSync(join(tmpdir(), "emp-test-"));
    writeFileSync(join(dir, "u1.json"), JSON.stringify({ userId: "u1" }));
    writeFileSync(join(dir, "u2.json"), JSON.stringify({ userId: "u2" }));
    const repo = createEmployeeProfileRepo(dir);
    expect(repo.list()).toHaveLength(2);
  });

  it("get returns profile by userId", () => {
    const dir = mkdtempSync(join(tmpdir(), "emp-test-"));
    writeFileSync(join(dir, "u1.json"), JSON.stringify({ userId: "u1", displayName: "张三" }));
    const repo = createEmployeeProfileRepo(dir);
    expect(repo.get("u1")?.displayName).toBe("张三");
  });

  it("get returns undefined for missing userId", () => {
    const dir = mkdtempSync(join(tmpdir(), "emp-test-"));
    const repo = createEmployeeProfileRepo(dir);
    expect(repo.get("nonexistent")).toBeUndefined();
  });
});
