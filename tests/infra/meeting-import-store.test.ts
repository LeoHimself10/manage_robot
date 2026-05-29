import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createWorkbenchFormalTaskStore } from "../../src/infra/workbench-formal-task-store";

describe("meeting import store schema", () => {
  it("creates batch and appends subtask with optional dueAt", () => {
    const dir = mkdtempSync(join(tmpdir(), "mi-store-"));
    process.env.WORKBENCH_SQLITE_PATH = join(dir, "wb.sqlite");
    const store = createWorkbenchFormalTaskStore();

    const batch = store.createMeetingImportBatch({
      managerUserId: "mgr-1",
      meetingTitle: "周会",
      sourceTextHash: "abc123",
    });
    expect(batch.batchId).toMatch(/^mib:/);

    const project = store.createProject({
      ownerUserId: "mgr-1",
      name: "OCT",
    });

    const planId = "plan-meeting-test-1";
    const session = {
      planId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      senderStaffId: "mgr-1",
      latestDraft: {
        title: "父任务",
        tasks: [
          {
            id: "t1",
            title: "子任务A",
            objective: "目标",
            deliverables: "交付",
            completionCriteria: "标准",
          },
        ],
      },
      latestAssignment: {
        assignments: [{ taskId: "t1", primary: { userId: "emp-1" } }],
      },
      conversationHistory: [],
      knownFacts: [],
    };
    store.publishFromSession({
      planId,
      session: session as never,
      managerUserId: "mgr-1",
      initiatorDepartment: "研发",
      actorUserId: "mgr-1",
      projectId: project.projectId,
    });

    const appended = store.appendSubtaskFromMeetingImport({
      planId,
      managerUserId: "mgr-1",
      title: "会议新增子任务",
      assigneeUserId: "emp-2",
      objective: "完成会议行动项",
      deliverables: "交付物",
      completionCriteria: "可验收",
      sourceMeetingBatchId: batch.batchId,
      sourceExcerpt: "Action: 会议新增子任务",
      clientRequestId: `mib:${batch.batchId}:item-1`,
    });
    expect(appended.subtask.title).toBe("会议新增子任务");
    expect(appended.subtask.sourceMeetingBatchId).toBe(batch.batchId);
    expect(appended.subtask.sourceExcerpt).toContain("会议新增");

    store.setTaskSourceMeetingBatch({
      taskId: appended.task.taskId,
      managerUserId: "mgr-1",
      sourceMeetingBatchId: batch.batchId,
    });
    const detail = store.getTaskDetail(planId);
    expect(detail?.task.sourceMeetingBatchId).toBe(batch.batchId);

    const open = store.listOpenSubtasksForManagerProject({
      managerUserId: "mgr-1",
      projectId: project.projectId,
    });
    expect(open.length).toBeGreaterThanOrEqual(2);
  });
});
