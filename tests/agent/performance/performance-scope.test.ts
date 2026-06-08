import { describe, expect, it } from "vitest";
import { resolvePerformanceScope, performanceScopeLabel } from "../../../src/agent/performance/performance-scope";

describe("resolvePerformanceScope", () => {
  it("admin session → all scope regardless of userId", () => {
    expect(resolvePerformanceScope({ role: "admin", userId: "mgr-dual" })).toEqual({ kind: "all" });
  });

  it("manager session → manager scope even for dual admin user", () => {
    expect(resolvePerformanceScope({ role: "manager", userId: "mgr-dual" })).toEqual({
      kind: "manager",
      managerUserId: "mgr-dual",
    });
  });

  it("performanceScopeLabel", () => {
    expect(performanceScopeLabel({ kind: "all" })).toContain("全员");
    expect(performanceScopeLabel({ kind: "manager", managerUserId: "x" })).toContain("名下");
  });
});
