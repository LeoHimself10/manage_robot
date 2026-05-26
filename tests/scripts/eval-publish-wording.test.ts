import { describe, expect, it } from "vitest";
import {
  assistantUsesDispatchWording,
  assistantUsesPublishWording,
} from "../../scripts/eval-publish-wording";

describe("eval-publish-wording", () => {
  it("flags legacy 发布 in assistant message", () => {
    expect(assistantUsesPublishWording("任务已正式发布。")).toBe(true);
    expect(assistantUsesPublishWording("请确认发布")).toBe(true);
    expect(assistantUsesPublishWording("尚未发放，待员工承接")).toBe(false);
  });

  it("detects 发放 success phrasing", () => {
    expect(assistantUsesDispatchWording("任务已发放，员工需在待承接中确认")).toBe(true);
  });
});
