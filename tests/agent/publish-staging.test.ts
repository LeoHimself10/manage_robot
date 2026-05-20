import { describe, expect, it } from "vitest";
import {
  buildPublishRetryUserMessage,
  buildScopeSwitchRetryUserMessage,
  detectFalsePublish,
  detectFalsePublishOnConfirm,
  formatAuthoritativePublishBlockedNotice,
  detectFalseScopeSwitch,
  detectTopicSwitchWithoutArchive,
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
    it("true when user confirms publish and draft has tasks (even not staged)", () => {
      expect(
        shouldInjectPublishStagingMemoryHint({
          userMessage: "确认",
          latestDraft: { tasks: [{ id: "task_1" }] },
        }),
      ).toBe(true);
    });
    it("false when no draft tasks or user not confirming", () => {
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

  describe("detectFalsePublishOnConfirm", () => {
    it("true when user confirms publish and model claims published without tool", () => {
      expect(
        detectFalsePublishOnConfirm({
          userMessage: "确认发布",
          preTurnLatestDraft: {},
          toolInvocationNames: [],
          hasPublishResult: false,
          outboundMarkdown: "任务已成功发布。",
        }),
      ).toBe(true);
    });
    it("false when draft not staged but not claiming publish", () => {
      expect(
        detectFalsePublishOnConfirm({
          userMessage: "确认发布",
          preTurnLatestDraft: {},
          toolInvocationNames: [],
          hasPublishResult: false,
          outboundMarkdown: "请稍候",
        }),
      ).toBe(false);
    });
  });

  describe("formatAuthoritativePublishBlockedNotice", () => {
    it("explains missing assignee / prepare args", () => {
      const msg = formatAuthoritativePublishBlockedNotice({
        skippedReason: "cannot_build_prepare_args",
      });
      expect(msg).toContain("尚未发布");
      expect(msg).toContain("负责人");
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

  describe("detectFalseScopeSwitch", () => {
    it("returns true when model claims scope switched but start_new_task not called", () => {
      expect(detectFalseScopeSwitch({
        userMessage: "重新开个任务",
        toolInvocationNames: [],
        outboundMarkdown: "好的，已归档旧任务，已切换到新任务。",
      })).toBe(true);
    });
    it("returns false when start_new_task was called", () => {
      expect(detectFalseScopeSwitch({
        userMessage: "重新开个任务",
        toolInvocationNames: ["start_new_task"],
        outboundMarkdown: "已归档旧任务，切换完成。",
      })).toBe(false);
    });
    it("returns false when message does not claim scope switch", () => {
      expect(detectFalseScopeSwitch({
        userMessage: "修改一下任务标题",
        toolInvocationNames: [],
        outboundMarkdown: "好的，帮您修改标题。",
      })).toBe(false);
    });
    it("returns true for '已切到新任务' claim without tool", () => {
      expect(detectFalseScopeSwitch({
        userMessage: "换个任务",
        toolInvocationNames: [],
        outboundMarkdown: "已切到新任务，当前草案已清空。",
      })).toBe(true);
    });
  });

  describe("buildScopeSwitchRetryUserMessage", () => {
    it("produces message with start_new_task instruction", () => {
      const out = buildScopeSwitchRetryUserMessage("换个任务，做别的了");
      expect(out).toContain("start_new_task");
      expect(out).toContain("换个任务");
    });
  });

  describe("detectTopicSwitchWithoutArchive", () => {
    it("true when user signals new topic and draft exists without start_new_task", () => {
      expect(
        detectTopicSwitchWithoutArchive({
          userMessage: "我们换个问题，做一下来料检验",
          preTurnLatestDraft: { tasks: [{ id: "task_1" }] },
          toolInvocationNames: [],
        }),
      ).toBe(true);
    });
    it("false on publish confirm short phrase", () => {
      expect(
        detectTopicSwitchWithoutArchive({
          userMessage: "确认发布",
          preTurnLatestDraft: { tasks: [{ id: "task_1" }] },
          toolInvocationNames: [],
        }),
      ).toBe(false);
    });
    it("false when start_new_task was called", () => {
      expect(
        detectTopicSwitchWithoutArchive({
          userMessage: "换个新任务",
          preTurnLatestDraft: { tasks: [] },
          toolInvocationNames: ["start_new_task"],
        }),
      ).toBe(false);
    });
    it("false when no draft in session", () => {
      expect(
        detectTopicSwitchWithoutArchive({
          userMessage: "换个新任务",
          preTurnLatestDraft: undefined,
          toolInvocationNames: [],
        }),
      ).toBe(false);
    });
  });
});
