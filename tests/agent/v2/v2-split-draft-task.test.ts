import { describe, expect, it } from "vitest";
import type { PlanSession } from "../../../src/infra/plan-session-store";
import { buildSplitDraftTaskHandler } from "../../../src/agent/v2/split-draft-task-tool";

function makeSession(tasks: Array<Record<string, unknown>>): PlanSession {
  return {
    chatKeyHash: "h",
    planId: "p1",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    conversationHistory: [],
    knownFacts: [],
    latestDraft: {
      title: "草案",
      tasks,
    },
  } as PlanSession;
}

describe("buildSplitDraftTaskHandler", () => {
  it("splits one row into two: updates source + inserts one new row", () => {
    const session = makeSession([
      { id: "task_1", title: "原任务1", timeNode: { dueAt: "2026-07-01" } },
      { id: "task_2", title: "原任务2", timeNode: { dueAt: "2026-07-15" } },
    ]);
    const handler = buildSplitDraftTaskHandler({ currentSession: session });

    const result = handler({
      taskId: "task_2",
      tasks: [
        { title: "拆分A", objective: "目标A" },
        { title: "拆分B", objective: "目标B" },
      ],
    }) as Record<string, unknown>;

    expect(result.ok).toBe(true);
    expect(result.splitInto).toBe(2);
    const draftTasks = (session.latestDraft as { tasks: Array<Record<string, unknown>> }).tasks;
    expect(draftTasks).toHaveLength(3);
    expect(draftTasks[1].title).toBe("拆分A");
    expect(draftTasks[2].title).toBe("拆分B");
    expect((draftTasks[2].timeNode as { dueAt?: string }).dueAt).toBe("2026-07-15");
  });

  it("splits one row into three sequential inserts", () => {
    const session = makeSession([
      { id: "task_1", title: "唯一行" },
    ]);
    const handler = buildSplitDraftTaskHandler({ currentSession: session });

    const result = handler({
      taskId: "task_1",
      tasks: [{ title: "A" }, { title: "B" }, { title: "C" }],
    }) as Record<string, unknown>;

    expect(result.ok).toBe(true);
    expect(result.splitInto).toBe(3);
    const draftTasks = (session.latestDraft as { tasks: Array<Record<string, unknown>> }).tasks;
    expect(draftTasks).toHaveLength(3);
    expect(draftTasks.map((t) => t.title)).toEqual(["A", "B", "C"]);
  });

  it("rejects unknown taskId", () => {
    const session = makeSession([{ id: "task_1", title: "行1" }]);
    const handler = buildSplitDraftTaskHandler({ currentSession: session });
    const result = handler({
      taskId: "task_99",
      tasks: [{ title: "A" }, { title: "B" }],
    }) as Record<string, unknown>;
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("unknown_task_id");
  });

  it("rejects fewer than 2 tasks", () => {
    const session = makeSession([{ id: "task_1", title: "行1" }]);
    const handler = buildSplitDraftTaskHandler({ currentSession: session });
    const result = handler({
      taskId: "task_1",
      tasks: [{ title: "仅一条" }],
    }) as Record<string, unknown>;
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("tasks_too_few");
  });

  it("rejects no draft", () => {
    const session = {
      chatKeyHash: "h",
      planId: "p1",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      conversationHistory: [],
      knownFacts: [],
    } as PlanSession;
    const handler = buildSplitDraftTaskHandler({ currentSession: session });
    const result = handler({
      taskId: "task_1",
      tasks: [{ title: "A" }, { title: "B" }],
    }) as Record<string, unknown>;
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("no_draft");
  });

  it("calls onSessionMutated once after successful split", () => {
    const session = makeSession([{ id: "task_1", title: "行1" }]);
    const snapshots: number[] = [];
    const handler = buildSplitDraftTaskHandler({
      currentSession: session,
      onSessionMutated: (s) => {
        snapshots.push((s.latestDraft as { tasks: unknown[] }).tasks.length);
      },
    });
    handler({
      taskId: "task_1",
      tasks: [{ title: "A" }, { title: "B" }],
    });
    expect(snapshots).toEqual([2]);
  });

  it("supports English-style split payloads", () => {
    const session = makeSession([
      { id: "task_1", title: "Package A" },
      { id: "task_2", title: "Package B" },
    ]);
    const handler = buildSplitDraftTaskHandler({ currentSession: session });
    const result = handler({
      taskId: "task_2",
      tasks: [
        { title: "Sub-package B1", objective: "Hardware check" },
        { title: "Sub-package B2", objective: "Structural check" },
      ],
    }) as Record<string, unknown>;
    expect(result.ok).toBe(true);
    expect((session.latestDraft as { tasks: unknown[] }).tasks).toHaveLength(3);
  });
});
