import { describe, expect, it } from "vitest";
import {
  deriveManagerAttentionLabel,
  managerSubtaskFilterMatches,
  subtaskNeedsManagerAction,
} from "../../src/web/workbench-attention.js";

describe("deriveManagerAttentionLabel", () => {
  it("returns 已完成 when all subtasks done", () => {
    const r = deriveManagerAttentionLabel([
      { status: "DONE" },
      { status: "DONE" },
    ]);
    expect(r.attentionLabel).toBe("已完成");
    expect(r.attentionBucket).toBe("done");
  });

  it("returns 阻塞中 when any blocked (before needs_manager)", () => {
    const r = deriveManagerAttentionLabel([
      { status: "IN_PROGRESS" },
      { status: "BLOCKED" },
    ]);
    expect(r.attentionLabel).toBe("阻塞中");
    expect(r.attentionBucket).toBe("blocked");
  });

  it("returns 待您处理 for rejected or open changes", () => {
    expect(
      deriveManagerAttentionLabel([{ status: "ASSIGNED" }, { status: "REJECTED" }])
        .attentionLabel,
    ).toBe("待您处理");
    expect(
      deriveManagerAttentionLabel([
        { status: "IN_PROGRESS", openDeclineKind: "changes" },
      ]).attentionLabel,
    ).toBe("待您处理");
  });

  it("returns 待员工承接 for assigned only without manager action", () => {
    const r = deriveManagerAttentionLabel([
      { status: "ASSIGNED" },
      { status: "IN_PROGRESS" },
    ]);
    expect(r.attentionLabel).toBe("待员工承接");
    expect(r.attentionBucket).toBe("waiting_employee");
    expect(r.openManagerSubtaskCount).toBe(0);
  });

  it("returns 员工执行中 when only in progress", () => {
    const r = deriveManagerAttentionLabel([{ status: "IN_PROGRESS" }]);
    expect(r.attentionLabel).toBe("员工执行中");
    expect(r.attentionBucket).toBe("employee_running");
  });

  it("returns 已停止 when only done and stopped remain", () => {
    const r = deriveManagerAttentionLabel([
      { status: "DONE" },
      { status: "STOPPED" },
    ]);
    expect(r.attentionLabel).toBe("已停止");
    expect(r.attentionBucket).toBe("stopped");
  });
});

describe("subtaskNeedsManagerAction", () => {
  it("does not treat plain ASSIGNED as needs manager", () => {
    expect(subtaskNeedsManagerAction({ status: "ASSIGNED" })).toBe(false);
  });
});

describe("managerSubtaskFilterMatches", () => {
  it("shows IN_PROGRESS and BLOCKED under 进行中", () => {
    expect(managerSubtaskFilterMatches({ status: "IN_PROGRESS" }, "in_progress")).toBe(true);
    expect(managerSubtaskFilterMatches({ status: "BLOCKED" }, "in_progress")).toBe(true);
    expect(managerSubtaskFilterMatches({ status: "ACCEPTED" }, "in_progress")).toBe(true);
  });

  it("managerSubtaskFilterMatches stopped bucket", () => {
    expect(managerSubtaskFilterMatches({ status: "STOPPED" }, "stopped")).toBe(true);
    expect(managerSubtaskFilterMatches({ status: "STOPPED" }, "in_progress")).toBe(false);
  });

  it("hides waiting and manager-action rows from 进行中", () => {
    expect(managerSubtaskFilterMatches({ status: "ASSIGNED" }, "in_progress")).toBe(false);
    expect(
      managerSubtaskFilterMatches({ status: "IN_PROGRESS", openDeclineKind: "changes" }, "in_progress"),
    ).toBe(false);
  });
});
