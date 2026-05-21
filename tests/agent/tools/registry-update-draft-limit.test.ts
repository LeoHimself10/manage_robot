import { describe, expect, it } from "vitest";
import { buildToolRegistry } from "../../../src/agent/tools/registry";
import type { PlanSession } from "../../../src/infra/plan-session-store";

describe("buildToolRegistry update_draft_task soft limit", () => {
  const session: PlanSession = {
    chatKeyHash: "h",
    planId: "p1",
    senderStaffId: "mgr",
    conversationHistory: [],
    knownFacts: [],
    latestDraft: {
      tasks: [{ id: "task_1", title: "T1" }, { id: "task_2", title: "T2" }],
    },
  };

  it("rejects after 4 update_draft_task calls in same orchestrator", () => {
    const registry = buildToolRegistry({
      employeeRepo: { list: () => [], get: () => undefined },
      toolProfile: "manager",
      trustedActorUserId: "mgr",
      currentSession: session,
    });
    const handler = registry.update_draft_task.handler;
    for (let i = 0; i < 4; i++) {
      const r = handler({ subtaskId: "task_1", patch: { title: `T${i}` } }) as {
        ok?: boolean;
      };
      expect(r.ok).not.toBe(false);
    }
    const blocked = handler({
      subtaskId: "task_2",
      patch: { title: "blocked" },
    }) as { ok: boolean; reason?: string };
    expect(blocked.ok).toBe(false);
    expect(blocked.reason).toBe("too_many_draft_patches");
  });
});
