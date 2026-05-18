import { describe, expect, it } from "vitest";
import { presentWorkbenchTaskEvent } from "../../src/infra/workbench-event-present";

describe("workbench-event-present", () => {
  it("formats SUBTASK_ACCEPTED", () => {
    const e = presentWorkbenchTaskEvent({
      event_type: "SUBTASK_ACCEPTED",
      occurred_at: "2026-01-01T00:00:00.000Z",
      actor_user_id: "u1",
      note: "ok",
      payload_json: "{}",
    });
    expect(e.title).toContain("接受");
    expect(e.severity).toBe("info");
  });

  it("puts raw error into detail for EMPLOYEE_NOTIFY_FAILED", () => {
    const raw = '400 {"err":"x"}';
    const e = presentWorkbenchTaskEvent({
      event_type: "EMPLOYEE_NOTIFY_FAILED",
      occurred_at: "2026-01-01T00:00:00.000Z",
      actor_user_id: "sys",
      note: raw,
      payload_json: null,
    });
    expect(e.detail).toBe(raw);
    expect(e.summary).not.toContain("400 {");
  });

  it("covers unknown event types", () => {
    const e = presentWorkbenchTaskEvent({
      event_type: "CUSTOM_X",
      occurred_at: "2026-01-01T00:00:00.000Z",
      actor_user_id: "u1",
      note: "hello",
      payload_json: null,
    });
    expect(e.title).toBeTruthy();
    expect(e.summary).toContain("hello");
  });

  it("formats MANAGER_DECLINE_CHANGES and MANAGER_ACK_SUBTASK_SIGNAL", () => {
    const d = presentWorkbenchTaskEvent({
      event_type: "MANAGER_DECLINE_CHANGES",
      occurred_at: "2026-01-01T00:00:00.000Z",
      actor_user_id: "m1",
      note: "范围不变",
      payload_json: "{}",
    });
    expect(d.title).toContain("驳回");
    const a = presentWorkbenchTaskEvent({
      event_type: "MANAGER_ACK_SUBTASK_SIGNAL",
      occurred_at: "2026-01-01T00:00:00.000Z",
      actor_user_id: "m1",
      note: "",
      payload_json: JSON.stringify({ signal: "done" }),
    });
    expect(a.title).toContain("已知悉");
    expect(a.summary).toContain("完成");
  });

  it("formats SUBTASK_CUSTOMIZE_NOTE", () => {
    const e = presentWorkbenchTaskEvent({
      event_type: "SUBTASK_CUSTOMIZE_NOTE",
      occurred_at: "2026-01-01T00:00:00.000Z",
      actor_user_id: "u1",
      note: "补充材料已上传",
      payload_json: "{}",
    });
    expect(e.title).toContain("补充说明");
    expect(e.severity).toBe("info");
  });

  it("MANAGER_REASSIGN omits raw JSON detail unless showManagerReassignPayload", () => {
    const row = {
      event_type: "MANAGER_REASSIGN",
      occurred_at: "2026-01-01T00:00:00.000Z",
      actor_user_id: "m1",
      note: "改派说明",
      payload_json: JSON.stringify({ assigneeUserId: "u2", subtaskId: "task:p:t1" }),
    };
    const noPayload = presentWorkbenchTaskEvent(row, { resolveActorName: () => "王主管" });
    expect(noPayload.detail).toBeUndefined();
    const withPayload = presentWorkbenchTaskEvent(row, {
      resolveActorName: () => "王主管",
      showManagerReassignPayload: true,
    });
    expect(withPayload.detail).toContain("assigneeUserId");
  });
});
