import { describe, expect, it } from "vitest";
import { buildProjectRollupCards } from "../../src/infra/workbench-project-rollup";
import type { WorkbenchProjectRow } from "../../src/infra/workbench-project-types";

describe("buildProjectRollupCards", () => {
  const projects: WorkbenchProjectRow[] = [
    {
      projectId: "proj:a",
      name: "OCT",
      ownerUserId: "m1",
      status: "active",
      aliases: [],
      createdAt: "",
      updatedAt: "",
    },
  ];

  it("aggregates blocked subtasks into headline", () => {
    const cards = buildProjectRollupCards({
      projects,
      tasks: [
        {
          taskId: "t1",
          taskNo: "T-1",
          planId: "p1",
          title: "任务",
          status: "IN_PROGRESS",
          initiatorUserId: "i",
          initiatorDepartment: "d",
          managerUserId: "m1",
          publishedAt: "",
          createdAt: "",
          updatedAt: "2026-05-20T00:00:00.000Z",
          projectId: "proj:a",
          subtasksCount: 2,
          blockedCount: 1,
        },
      ],
      getTaskAttention: () => ({
        subtaskInputs: [
          { status: "BLOCKED", openDeclineKind: undefined },
          { status: "IN_PROGRESS", openDeclineKind: undefined },
        ],
        attentionLabel: "阻塞中",
        attentionBucket: "blocked",
      }),
    });
    expect(cards).toHaveLength(1);
    expect(cards[0]?.breakdown.blocked).toBe(1);
    expect(cards[0]?.headline).toContain("阻塞");
  });

  it("includes unassigned bucket only when tasks exist", () => {
    const cards = buildProjectRollupCards({
      projects,
      tasks: [
        {
          taskId: "t2",
          taskNo: "T-2",
          planId: "p2",
          title: "无项目",
          status: "ASSIGNED",
          initiatorUserId: "i",
          initiatorDepartment: "d",
          managerUserId: "m1",
          publishedAt: "",
          createdAt: "",
          updatedAt: "",
          projectId: undefined,
          subtasksCount: 1,
          blockedCount: 0,
        },
      ],
      getTaskAttention: () => ({
        subtaskInputs: [{ status: "ASSIGNED", openDeclineKind: undefined }],
        attentionLabel: "待员工承接",
        attentionBucket: "waiting_employee",
      }),
    });
    const unassigned = cards.find((c) => c.projectId === "__unassigned__");
    expect(unassigned).toBeDefined();
    expect(unassigned?.taskCount).toBe(1);
  });
});
