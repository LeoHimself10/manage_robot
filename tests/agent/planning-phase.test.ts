import { describe, expect, it } from "vitest";
import {
  shouldExposeEmployeeSearchTools,
  shouldInjectCandidatePoolMemoryHint,
} from "../../src/agent/planning-phase";

describe("planning-phase employee search exposure", () => {
  it("hides search tools when user only supplements deadline/background", () => {
    expect(
      shouldExposeEmployeeSearchTools({
        userMessage: "两周内完成，涉及3台机器，报错1210通信超时",
        hasLatestDraft: false,
        hasPendingRoster: false,
        hasCandidatePool: true,
      }),
    ).toBe(false);
  });

  it("exposes search tools on assignment intent", () => {
    expect(
      shouldExposeEmployeeSearchTools({
        userMessage: "按名单分配吧，杨楚榛和杨贺新",
        hasLatestDraft: true,
        hasPendingRoster: false,
        hasCandidatePool: true,
      }),
    ).toBe(true);
  });

  it("exposes when pending roster uploaded", () => {
    expect(
      shouldExposeEmployeeSearchTools({
        userMessage: "继续",
        hasLatestDraft: false,
        hasPendingRoster: true,
        hasCandidatePool: false,
      }),
    ).toBe(true);
  });

  it("does not inject candidatePool hint when search hidden", () => {
    const input = {
      userMessage: "期望两周内完成",
      hasLatestDraft: false,
      hasPendingRoster: false,
      hasCandidatePool: true,
    };
    expect(shouldExposeEmployeeSearchTools(input)).toBe(false);
    expect(shouldInjectCandidatePoolMemoryHint(input)).toBe(false);
  });
});
