import { describe, expect, it } from "vitest";
import { profileCaseOutcomeKeyForSubtask } from "../../../src/agent/profile/profile-case-worker";

describe("profileCaseOutcomeKeyForSubtask", () => {
  it("returns stable prefixed key", () => {
    expect(profileCaseOutcomeKeyForSubtask("st_123")).toBe("workbench_subtask:st_123");
  });

  it("trims whitespace", () => {
    expect(profileCaseOutcomeKeyForSubtask("  abc  ")).toBe("workbench_subtask:abc");
  });
});
