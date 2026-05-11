import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { signAssignmentEntry } from "../../src/security/web-entry-token";
import {
  ensureWorkbenchAccess,
  resolveWorkbenchIdentityFromToken,
} from "../../src/web/workbench-auth";

describe("workbench-auth", () => {
  beforeEach(() => {
    vi.stubEnv(
      "ASSIGNMENT_WEB_SECRET",
      "test-secret-at-least-32-chars-long-for-security",
    );
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("allows a manager to open the manager workbench route", () => {
    const signed = signAssignmentEntry({
      planId: "p1",
      userId: "manager-1",
      role: "manager",
      ttlSeconds: 60,
    });

    const identity = resolveWorkbenchIdentityFromToken(signed.token);

    expect(identity).toMatchObject({
      planId: "p1",
      userId: "manager-1",
      role: "manager",
    });
    expect(() =>
      ensureWorkbenchAccess(identity.role, "/workbench/manager"),
    ).not.toThrow();
  });

  it("blocks an employee from opening the manager workbench route", () => {
    const signed = signAssignmentEntry({
      planId: "p1",
      userId: "employee-1",
      role: "employee",
      ttlSeconds: 60,
    });

    const identity = resolveWorkbenchIdentityFromToken(signed.token);

    expect(identity.role).toBe("employee");
    expect(() =>
      ensureWorkbenchAccess(identity.role, "/workbench/manager"),
    ).toThrow("Forbidden");
  });
});
