import { describe, expect, it } from "vitest";
import {
  buildSplitRetryUserMessage,
  detectFalseSplit,
  hasRowSplitIntent,
  hasWholeTableRedraftIntent,
  looksLikeFalseSplitClaim,
} from "../../../src/agent/draft-mutation/false-split";

const DRAFT_5 = {
  tasks: [
    { id: "task_1", title: "A" },
    { id: "task_2", title: "B" },
    { id: "task_3", title: "C" },
    { id: "task_4", title: "D" },
    { id: "task_5", title: "E" },
  ],
};

describe("false-split intent", () => {
  it("detects row split intent for prod phrasing", () => {
    expect(hasRowSplitIntent("把任务2拆成2个小任务")).toBe(true);
    expect(hasRowSplitIntent("任务2拆成2条")).toBe(true);
    expect(hasRowSplitIntent("把 task_2 分成两个工作包")).toBe(true);
  });

  it("does not flag patch or assign or whole-table redraft", () => {
    expect(hasRowSplitIntent("task_2 改到 2026-06-30")).toBe(false);
    expect(hasRowSplitIntent("请点将分配给姚雪峰")).toBe(false);
    expect(hasRowSplitIntent("整表拆更细，扩成 8 条")).toBe(false);
    expect(hasWholeTableRedraftIntent("整表拆更细，扩成 8 条")).toBe(true);
    expect(hasWholeTableRedraftIntent("把任务2拆成2个小任务")).toBe(false);
  });

  it("detects false split when task count unchanged and message claims split", () => {
    expect(
      detectFalseSplit({
        userMessage: "把任务2拆成2个小任务",
        preTurnDraft: DRAFT_5,
        postTurnDraft: DRAFT_5,
        outboundMarkdown: "已将任务 2 拆分为两个更具体的子任务：1. … 2. …",
        toolInvocationNames: [],
      }),
    ).toBe(true);
  });

  it("does not flag successful add_draft_subtask with increased count", () => {
    const after = {
      tasks: [
        ...DRAFT_5.tasks.slice(0, 2),
        { id: "task_6", title: "B-split" },
        ...DRAFT_5.tasks.slice(2),
      ],
    };
    expect(
      detectFalseSplit({
        userMessage: "把任务2拆成2个小任务",
        preTurnDraft: DRAFT_5,
        postTurnDraft: after,
        outboundMarkdown: "已拆分完成。",
        toolInvocationNames: ["update_draft_task", "add_draft_subtask"],
      }),
    ).toBe(false);
  });

  it("does not flag whole-table redraft phrasing", () => {
    expect(
      detectFalseSplit({
        userMessage: "请把整张表拆得更细，扩成 8 条",
        preTurnDraft: DRAFT_5,
        postTurnDraft: DRAFT_5,
        outboundMarkdown: "已重新拆解…",
        toolInvocationNames: [],
      }),
    ).toBe(false);
  });

  it("matches split success phrases", () => {
    expect(looksLikeFalseSplitClaim("已将任务 2 拆分为两个子任务。")).toBe(true);
    expect(looksLikeFalseSplitClaim("尚未完成拆分")).toBe(false);
  });

  it("buildSplitRetryUserMessage includes original user text", () => {
    const msg = buildSplitRetryUserMessage({
      originalUserMessage: "把任务2拆成2个小任务",
      taskIndexMap: [{ n: 2, id: "task_2", title: "B" }],
    });
    expect(msg).toContain("[split_retry_required]");
    expect(msg).toContain("add_draft_subtask");
    expect(msg).toContain("把任务2拆成2个小任务");
  });
});
