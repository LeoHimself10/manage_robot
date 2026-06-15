/**
 * Reproduction test: after split_draft_task expands a 6-task draft into 8 tasks,
 * bulk_assign_tasks called with the original 6 IDs fails with partial_assignment.
 *
 * Mirrors the production incident where the v2 agent created duplicate projects:
 * bulk_assign_tasks failed → assign-retry triggered → retry called create_project again.
 */
import { describe, expect, it, beforeEach } from "vitest";
import type { PlanSession } from "../../../src/infra/plan-session-store";
import { buildBulkAssignTasksHandler } from "../../../src/agent/tools/bulk-assign-tasks";
import { buildSplitDraftTaskHandler } from "../../../src/agent/v2/split-draft-task-tool";

const CONTACTS: Record<string, { userId: string; name: string; active: boolean }> = {
  "uid-ykh": { userId: "uid-ykh", name: "姚凯珩", active: true },
};

function getContact(userId: string) {
  return CONTACTS[userId];
}

function makeSession(overrides: Partial<PlanSession> = {}): PlanSession {
  return {
    chatKeyHash: "h",
    planId: "p1",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    conversationHistory: [],
    knownFacts: [],
    latestDraft: {
      title: "Agent工程组RAG知识与落地培训",
      tasks: [
        { id: "task_1", title: "需求梳理与范围界定", timeNode: { dueAt: "2026-06-20" } },
        { id: "task_2", title: "知识库建设", timeNode: { dueAt: "2026-06-25" } },
        { id: "task_3", title: "RAG 架构方案设计", timeNode: { dueAt: "2026-06-28" } },
        { id: "task_4", title: "模型微调", timeNode: { dueAt: "2026-07-05" } },
        { id: "task_5", title: "系统集成测试", timeNode: { dueAt: "2026-07-10" } },
        { id: "task_6", title: "培训材料与上线", timeNode: { dueAt: "2026-07-15" } },
      ],
    },
    // Simulate search result for 姚凯珩 already in cache
    lastEmployeeSearchHits: [
      { userId: "uid-ykh", displayName: "姚凯珩", hitAt: new Date().toISOString() },
    ],
    ...overrides,
  } as PlanSession;
}

describe("bulk_assign_tasks 复现：split 后 partial_assignment", () => {
  let session: PlanSession;

  beforeEach(() => {
    session = makeSession();
  });

  it("6条草案全量assign → ok", () => {
    const handler = buildBulkAssignTasksHandler({ currentSession: session, getContact });
    const result = handler({
      assignments: [
        { taskId: "task_1", assigneeUserId: "uid-ykh" },
        { taskId: "task_2", assigneeUserId: "uid-ykh" },
        { taskId: "task_3", assigneeUserId: "uid-ykh" },
        { taskId: "task_4", assigneeUserId: "uid-ykh" },
        { taskId: "task_5", assigneeUserId: "uid-ykh" },
        { taskId: "task_6", assigneeUserId: "uid-ykh" },
      ],
    }) as Record<string, unknown>;
    expect(result.ok).toBe(true);
  });

  it("split后草案变为8条，模型仍传6个原始ID → partial_assignment（复现失败）", () => {
    // 模拟 split_draft_task(task_3 → 2条) + split_draft_task(task_5 → 2条)
    const splitHandler = buildSplitDraftTaskHandler({ currentSession: session });

    const split1 = splitHandler({
      taskId: "task_3",
      tasks: [
        { title: "RAG 架构方案设计 - 向量化方案", dueAt: "2026-06-28" },
        { title: "RAG 架构方案设计 - 检索策略设计", dueAt: "2026-06-28" },
      ],
    }) as Record<string, unknown>;
    expect(split1.ok).toBe(true);
    // task_3 保留，新增了一条（task_7）

    const split2 = splitHandler({
      taskId: "task_5",
      tasks: [
        { title: "系统集成测试 - 单元测试", dueAt: "2026-07-10" },
        { title: "系统集成测试 - E2E 测试", dueAt: "2026-07-10" },
      ],
    }) as Record<string, unknown>;
    expect(split2.ok).toBe(true);
    // task_5 保留，新增了一条（task_8）

    const draftTasks = (session.latestDraft as { tasks: Array<{ id: string }> }).tasks;
    expect(draftTasks).toHaveLength(8);

    const allIds = draftTasks.map((t) => t.id);
    console.log("Draft after splits:", allIds);

    // 模型只用了原始 6 个 ID（未感知 split 产生的新 ID）
    const handler = buildBulkAssignTasksHandler({ currentSession: session, getContact });
    const result = handler({
      assignments: [
        { taskId: "task_1", assigneeUserId: "uid-ykh" },
        { taskId: "task_2", assigneeUserId: "uid-ykh" },
        { taskId: "task_3", assigneeUserId: "uid-ykh" },
        { taskId: "task_4", assigneeUserId: "uid-ykh" },
        { taskId: "task_5", assigneeUserId: "uid-ykh" },
        { taskId: "task_6", assigneeUserId: "uid-ykh" },
      ],
    }) as Record<string, unknown>;

    // 应该失败，missing split产生的新 taskId
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("partial_assignment");
    console.log("Failure result:", result);
    // 缺少的是 split 产生的新 taskId（task_7 和 task_8）
    const missing = result.missingTaskIds as string[];
    expect(missing.length).toBe(2);
    // 新 taskId 是 task_7 和 task_8（由 allocTaskId 分配）
    expect(missing).toContain(allIds.find((id) => id !== "task_1" && id !== "task_2" && id !== "task_3" && id !== "task_4" && id !== "task_5" && id !== "task_6"));
  });

  it("split后传完整8个ID → ok", () => {
    const splitHandler = buildSplitDraftTaskHandler({ currentSession: session });

    const r1 = splitHandler({
      taskId: "task_3",
      tasks: [
        { title: "RAG 方案A" },
        { title: "RAG 方案B" },
      ],
    }) as Record<string, unknown>;
    expect(r1.ok).toBe(true);
    const newId1 = (r1.taskIds as string[])[1]; // split产生的第二条

    const r2 = splitHandler({
      taskId: "task_5",
      tasks: [
        { title: "测试A" },
        { title: "测试B" },
      ],
    }) as Record<string, unknown>;
    expect(r2.ok).toBe(true);
    const newId2 = (r2.taskIds as string[])[1];

    const handler = buildBulkAssignTasksHandler({ currentSession: session, getContact });
    const result = handler({
      assignments: [
        { taskId: "task_1", assigneeUserId: "uid-ykh" },
        { taskId: "task_2", assigneeUserId: "uid-ykh" },
        { taskId: "task_3", assigneeUserId: "uid-ykh" },
        { taskId: newId1, assigneeUserId: "uid-ykh" },
        { taskId: "task_4", assigneeUserId: "uid-ykh" },
        { taskId: "task_5", assigneeUserId: "uid-ykh" },
        { taskId: newId2, assigneeUserId: "uid-ykh" },
        { taskId: "task_6", assigneeUserId: "uid-ykh" },
      ],
    }) as Record<string, unknown>;

    expect(result.ok).toBe(true);
  });
});

describe("bulk_assign_tasks fix：fillDefaultAssigneeUserId 全量补全", () => {
  it("split后用 fillDefaultAssigneeUserId 无需列举 taskId → ok", () => {
    const session = makeSession();
    const splitHandler = buildSplitDraftTaskHandler({ currentSession: session });
    splitHandler({ taskId: "task_3", tasks: [{ title: "A" }, { title: "B" }] });
    splitHandler({ taskId: "task_5", tasks: [{ title: "C" }, { title: "D" }] });

    const draftTasks = (session.latestDraft as { tasks: Array<{ id: string }> }).tasks;
    expect(draftTasks).toHaveLength(8);

    const handler = buildBulkAssignTasksHandler({ currentSession: session, getContact });
    const result = handler({
      assignments: [],
      fillDefaultAssigneeUserId: "uid-ykh",
    }) as Record<string, unknown>;

    expect(result.ok).toBe(true);
    console.log("fillDefault result:", result);
  });

  it("split后 fillDefaultAssigneeUserId + 部分显式覆盖 → ok", () => {
    const session = makeSession();
    const splitHandler = buildSplitDraftTaskHandler({ currentSession: session });
    const r1 = splitHandler({ taskId: "task_3", tasks: [{ title: "A" }, { title: "B" }] }) as Record<string, unknown>;
    const newId = (r1.taskIds as string[])[1];

    const handler = buildBulkAssignTasksHandler({ currentSession: session, getContact });
    // Override only the newly split task; fill the rest via default
    const result = handler({
      assignments: [{ taskId: newId, assigneeUserId: "uid-ykh" }],
      fillDefaultAssigneeUserId: "uid-ykh",
    }) as Record<string, unknown>;

    expect(result.ok).toBe(true);
  });
});

describe("bulk_assign_tasks 复现：传旧ID（split前的task_3）→ unknown_task_id", () => {
  it("split把task_3改名后，若模型传old id之外的内容 → unknown_task_id", () => {
    const session = makeSession();
    const handler = buildBulkAssignTasksHandler({ currentSession: session, getContact });
    // 传一个草案里没有的 taskId
    const result = handler({
      assignments: [
        { taskId: "task_1", assigneeUserId: "uid-ykh" },
        { taskId: "task_2", assigneeUserId: "uid-ykh" },
        { taskId: "task_3", assigneeUserId: "uid-ykh" },
        { taskId: "task_4", assigneeUserId: "uid-ykh" },
        { taskId: "task_5", assigneeUserId: "uid-ykh" },
        { taskId: "task_99", assigneeUserId: "uid-ykh" }, // 幻觉ID
      ],
    }) as Record<string, unknown>;

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("unknown_task_id");
    expect(result.taskId).toBe("task_99");
    console.log("unknown_task_id hint:", result.hint);
  });
});
