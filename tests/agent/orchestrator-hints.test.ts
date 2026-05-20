import { describe, expect, it } from "vitest";
import { shouldInjectExplicitDraftRequestHint } from "../../src/agent/orchestrator";

describe("shouldInjectExplicitDraftRequestHint", () => {
  it("matches common explicit draft requests", () => {
    expect(shouldInjectExplicitDraftRequestHint("请生成草案")).toBe(true);
    expect(shouldInjectExplicitDraftRequestHint("生成正式草案")).toBe(true);
    expect(shouldInjectExplicitDraftRequestHint("出草案")).toBe(true);
    expect(shouldInjectExplicitDraftRequestHint("生成任务表")).toBe(true);
  });

  it("does not match unrelated short messages", () => {
    expect(shouldInjectExplicitDraftRequestHint("确认发布")).toBe(false);
    expect(shouldInjectExplicitDraftRequestHint("可以发布了")).toBe(false);
  });
});
