import { describe, expect, it } from "vitest";
import {
  buildPublishRetryUserMessage,
  detectFalsePublish,
  isDraftStagedForPublish,
  isPublishConfirmUserMessage,
  looksLikeFalsePublishClaim,
  shouldInjectPublishStagingMemoryHint,
} from "../../src/agent/publish-staging";

describe("publish-staging", () => {
  describe("isDraftStagedForPublish", () => {
    it("true when stagedBy=prepare_publish_task", () => {
      expect(isDraftStagedForPublish({ stagedBy: "prepare_publish_task" })).toBe(true);
    });
    it("false when other stagedBy or missing", () => {
      expect(isDraftStagedForPublish({ stagedBy: "other" })).toBe(false);
      expect(isDraftStagedForPublish({})).toBe(false);
      expect(isDraftStagedForPublish(undefined)).toBe(false);
      expect(isDraftStagedForPublish(null)).toBe(false);
    });
  });

  describe("isPublishConfirmUserMessage", () => {
    it("recognizes core publish confirm phrases", () => {
      for (const phrase of [
        "确认",
        "发布",
        "发布吧",
        "确认发布",
        "好的发布",
        "可以了",
        "没问题",
        "OK 发布",
      ]) {
        expect(isPublishConfirmUserMessage(phrase)).toBe(true);
      }
    });
    it("rejects negation / long messages / pure assignment confirm", () => {
      expect(isPublishConfirmUserMessage("再改一下")).toBe(false);
      expect(isPublishConfirmUserMessage("先不发了，等我看一下")).toBe(false);
      expect(isPublishConfirmUserMessage("确认负责人")).toBe(false);
      expect(isPublishConfirmUserMessage("确认这个分配")).toBe(false);
      expect(isPublishConfirmUserMessage("我觉得方案不错，建议再补充一些细节后再发布")).toBe(false);
    });
  });

  describe("looksLikeFalsePublishClaim", () => {
    it("true when model claims published", () => {
      expect(looksLikeFalsePublishClaim("任务已发布。")).toBe(true);
      expect(looksLikeFalsePublishClaim("已正式发布给员工。")).toBe(true);
      expect(looksLikeFalsePublishClaim("已派发到员工待办。")).toBe(true);
    });
    it("false on preview / future-tense / negation", () => {
      expect(looksLikeFalsePublishClaim("即将发布的任务如下，请确认。")).toBe(false);
      expect(looksLikeFalsePublishClaim("是否确认发布？")).toBe(false);
      expect(looksLikeFalsePublishClaim("任务尚未发布，请再确认。")).toBe(false);
      expect(looksLikeFalsePublishClaim("")).toBe(false);
    });
  });

  describe("shouldInjectPublishStagingMemoryHint", () => {
    it("true when staged + user confirms publish", () => {
      expect(
        shouldInjectPublishStagingMemoryHint({
          userMessage: "发布",
          latestDraft: { stagedBy: "prepare_publish_task" },
        }),
      ).toBe(true);
    });
    it("false when not staged or user not confirming", () => {
      expect(
        shouldInjectPublishStagingMemoryHint({
          userMessage: "发布",
          latestDraft: {},
        }),
      ).toBe(false);
      expect(
        shouldInjectPublishStagingMemoryHint({
          userMessage: "再改一下 task_2",
          latestDraft: { stagedBy: "prepare_publish_task" },
        }),
      ).toBe(false);
    });
  });

  describe("detectFalsePublish", () => {
    const base = {
      userMessage: "发布",
      preTurnLatestDraft: { stagedBy: "prepare_publish_task" },
      toolInvocationNames: [] as string[],
      hasPublishResult: false,
      outboundMarkdown: "任务已发布。",
    };
    it("true when all four conditions met", () => {
      expect(detectFalsePublish(base)).toBe(true);
    });
    it("false when publish_task was actually called", () => {
      expect(detectFalsePublish({ ...base, toolInvocationNames: ["publish_task"] })).toBe(false);
    });
    it("false when hasPublishResult is true", () => {
      expect(detectFalsePublish({ ...base, hasPublishResult: true })).toBe(false);
    });
    it("false when draft is not staged", () => {
      expect(detectFalsePublish({ ...base, preTurnLatestDraft: {} })).toBe(false);
    });
    it("false when user is not confirming publish", () => {
      expect(detectFalsePublish({ ...base, userMessage: "再改一下" })).toBe(false);
    });
    it("false when outbound does not claim published", () => {
      expect(detectFalsePublish({ ...base, outboundMarkdown: "请确认发布" })).toBe(false);
    });
  });

  describe("buildPublishRetryUserMessage", () => {
    it("includes planId, original message, and forces publish_task tool call", () => {
      const out = buildPublishRetryUserMessage("发布", "plan-123");
      expect(out).toContain("publishStagingAction");
      expect(out).toContain("plan-123");
      expect(out).toContain("publish_task");
      expect(out).toContain("发布");
    });
    it("escapes double quotes inside confirmationContext", () => {
      const out = buildPublishRetryUserMessage('好的"立刻"发', "p1");
      const cc = out.match(/confirmationContext="([^"]*)"/);
      expect(cc).not.toBeNull();
      expect(cc?.[1]).toBe("好的'立刻'发");
    });
  });
});
