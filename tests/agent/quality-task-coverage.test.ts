import { describe, expect, it } from "vitest";
import {
  restoreQualityTaskMappings,
  validateQualityTaskCoverage,
} from "../../src/agent/quality-task-coverage";
import { buildPreparePublishTaskHandler } from "../../src/agent/tools/prepare-publish-task";
import type { PlanSession } from "../../src/infra/plan-session-store";

function session(taskDeliverableIds: string[]): PlanSession {
  const now = new Date().toISOString();
  return {
    chatKeyHash: "quality-session",
    planId: "quality-plan",
    createdAt: now,
    updatedAt: now,
    knownFacts: [],
    conversationHistory: [],
    latestDraft: {
      title: "质量任务规划",
      description: "根据正式质量初析拆解并发布任务。",
      qualityHandoff: { requiredDeliverableIds: ["deliverable-a", "deliverable-b"] },
      tasks: [{
        id: "task-1",
        title: "调查任务",
        objective: "完成调查",
        qualityDeliverableIds: taskDeliverableIds,
      }],
    },
    latestAssignment: {
      assignments: [{ taskId: "task-1", primary: { userId: "employee-1", displayName: "员工一" } }],
    },
  };
}

describe("quality required deliverable coverage gate", () => {
  it("reports uncovered required deliverables", () => {
    expect(validateQualityTaskCoverage(session(["deliverable-a"]))).toMatchObject({
      applicable: true,
      ok: false,
      missingDeliverableIds: ["deliverable-b"],
    });
  });

  it("blocks publish preflight until every required deliverable is mapped", () => {
    const blocked = buildPreparePublishTaskHandler({ currentSession: session(["deliverable-a"]) })(
      { planId: "quality-plan" },
    ) as { ok: boolean; reason?: string };
    expect(blocked).toMatchObject({ ok: false, reason: "quality_deliverables_uncovered" });

    const allowed = buildPreparePublishTaskHandler({
      currentSession: session(["deliverable-a", "deliverable-b"]),
    })({ planId: "quality-plan" }) as { ok: boolean; qualityCoverage?: { ok: boolean } };
    expect(allowed.ok).toBe(true);
    expect(allowed.qualityCoverage?.ok).toBe(true);
  });

  it("recovers legacy workbench mappings only from exact unique deliverable names", () => {
    const legacy = session([]);
    legacy.latestDraft = {
      ...(legacy.latestDraft as Record<string, unknown>),
      qualityTaskPackage: {
        requiredDeliverables: [
          { deliverableId: "deliverable-a", name: "检测报告", selected: true },
          { deliverableId: "deliverable-b", name: "追溯报告", selected: true },
        ],
      },
      tasks: [
        { id: "task-1", title: "检测报告", deliverables: ["检测报告"] },
        { id: "task-2", title: "追溯报告", deliverables: ["追溯报告"] },
      ],
    };

    const restored = restoreQualityTaskMappings(
      legacy.latestDraft as Record<string, unknown>,
    ) as Record<string, unknown>;
    expect((restored.tasks as Array<Record<string, unknown>>).map((task) => task.qualityDeliverableIds)).toEqual([
      ["deliverable-a"],
      ["deliverable-b"],
    ]);
    expect(validateQualityTaskCoverage({ latestDraft: restored })).toMatchObject({
      applicable: true,
      ok: true,
      missingDeliverableIds: [],
    });
  });
});
