import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  signAssignmentEntry,
  verifyAssignmentEntry,
} from "../../src/security/web-entry-token";

describe("web-entry-token", () => {
  beforeEach(() => {
    vi.stubEnv(
      "ASSIGNMENT_WEB_SECRET",
      "test-secret-at-least-32-chars-long-for-security",
    );
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("sign then verify returns correct data", () => {
    const signed = signAssignmentEntry({
      planId: "p1",
      userId: "u1",
      role: "manager",
      ttlSeconds: 60,
    });
    const verified = verifyAssignmentEntry(signed.token);
    expect(verified.planId).toBe("p1");
    expect(verified.userId).toBe("u1");
    expect(verified.role).toBe("manager");
  });

  it("throws on expired token", () => {
    const signed = signAssignmentEntry({
      planId: "p1",
      userId: "u1",
      role: "manager",
      ttlSeconds: -1,
    });
    expect(() => verifyAssignmentEntry(signed.token)).toThrow("expired");
  });

  it("throws on tampered signature", () => {
    const signed = signAssignmentEntry({
      planId: "p1",
      userId: "u1",
      role: "manager",
    });
    const tampered = signed.token + "x";
    expect(() => verifyAssignmentEntry(tampered)).toThrow("signature");
  });

  it("throws on invalid format", () => {
    expect(() => verifyAssignmentEntry("not-a-valid-token")).toThrow("format");
  });
});
