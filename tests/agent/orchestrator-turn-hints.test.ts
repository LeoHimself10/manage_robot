import { describe, expect, it } from "vitest";
import {
  buildTurnActionHintLine,
  isGenuineClarifyAssistantMessage,
  isStartNewTaskWelcomeMessage,
  resolveTurnActionHint,
  shouldInjectAssignActionHint,
  shouldInjectClarifyActionHint,
  shouldInjectPostClarifyDraftHint,
} from "../../src/agent/orchestrator-turn-hints";

const START_WELCOME =
  "已开启新任务。请描述您需要规划的具体工作，以及期望的完成时间？";

const GENUINE_CLARIFY =
  "请补充以下关键信息：1）产品型号与批次；2）期望完成时间？";

const USB_DISK_DESC =
  "我们收到客户反馈某批次 U 盘在产线老化测试中出现读写异常，需要排查根因并制定纠正措施。".repeat(
    2,
  );

describe("postClarify hint tightening", () => {
  it("does not treat start_new_task welcome as genuine CLARIFY", () => {
    expect(isStartNewTaskWelcomeMessage(START_WELCOME)).toBe(true);
    expect(isGenuineClarifyAssistantMessage(START_WELCOME)).toBe(false);
  });

  it("does not inject postClarify after start_new_task welcome + long U-disk desc without deadline", () => {
    const ctx = {
      conversationHistory: [{ role: "assistant", content: START_WELCOME }],
      latestDraft: undefined,
      memoryFacts: [],
    };
    expect(shouldInjectPostClarifyDraftHint(ctx, USB_DISK_DESC)).toBe(false);
    expect(shouldInjectClarifyActionHint(ctx, USB_DISK_DESC)).toBe(true);
    expect(resolveTurnActionHint(ctx, USB_DISK_DESC)).toEqual({ kind: "clarifyAction" });
    expect(buildTurnActionHintLine(ctx, USB_DISK_DESC)).toContain("clarifyAction");
  });

  it("injects postClarify after genuine CLARIFY when user adds deadline", () => {
    const ctx = {
      conversationHistory: [{ role: "assistant", content: GENUINE_CLARIFY }],
      latestDraft: undefined,
      memoryFacts: [],
    };
    const reply = `${USB_DISK_DESC} 请在 1 周内完成。`;
    expect(isGenuineClarifyAssistantMessage(GENUINE_CLARIFY)).toBe(true);
    expect(shouldInjectPostClarifyDraftHint(ctx, reply)).toBe(true);
    expect(resolveTurnActionHint(ctx, reply)).toEqual({ kind: "postClarifyDraftAction" });
  });

  it("explicit draft request without deadline yields clarifyAction", () => {
    const hint = resolveTurnActionHint(undefined, "请生成草案");
    expect(hint).toEqual({ kind: "clarifyAction" });
  });

  it("inject assignAction when draft exists and user asks for auto assign", () => {
    const ctx = {
      latestDraft: { tasks: [{ id: "task_1", title: "A" }] },
      conversationHistory: [],
      memoryFacts: [],
    };
    expect(shouldInjectAssignActionHint(ctx, "可以，由你为我分派")).toBe(true);
    expect(resolveTurnActionHint(ctx, "可以，由你为我分派")).toEqual({ kind: "assignAction" });
    expect(buildTurnActionHintLine(ctx, "可以，由你为我分派")).toContain("assignAction");
  });
});
