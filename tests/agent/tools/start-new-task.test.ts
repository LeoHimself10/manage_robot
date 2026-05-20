import { describe, expect, it } from "vitest";
import { buildStartNewTaskHandler } from "../../../src/agent/tools/start-new-task";
import type { PlanSession } from "../../../src/infra/plan-session-store";

function makeSession(overrides: Partial<PlanSession> = {}): PlanSession {
  const now = new Date().toISOString();
  return {
    chatKeyHash: "hash-1",
    planId: "plan-1",
    createdAt: now,
    updatedAt: now,
    knownFacts: [],
    conversationHistory: [],
    currentTaskScopeId: "scope:original",
    taskScopes: {
      "scope:original": {
        scopeId: "scope:original",
        scopeLabel: "OCT 主机问题",
        planId: "plan-1",
        createdAt: now,
        updatedAt: now,
      },
    },
    ...overrides,
  };
}

describe("start_new_task tool", () => {
  it("requires scopeLabel", () => {
    const handler = buildStartNewTaskHandler({ currentSession: makeSession() });
    const result = handler({}) as any;
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("missing_scope_label");
  });

  it("fails when session missing", () => {
    const handler = buildStartNewTaskHandler();
    const result = handler({ scopeLabel: "x" }) as any;
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("session_unavailable");
  });

  it("archives current draft and clears top-level fields", () => {
    const session = makeSession({
      latestDraft: { title: "OCT 主机 U 盘", tasks: [{ id: "t1", title: "现场排查" }] },
      latestAssignment: { assignments: [{ taskId: "t1", primary: { userId: "u1" } }] },
      knownFacts: ["上下文 OCT 设备型号 K5"],
    });
    const handler = buildStartNewTaskHandler({ currentSession: session });
    const result = handler({
      scopeLabel: "无纺布来料不合格",
      reason: "用户切换主题",
    }) as any;

    expect(result.ok).toBe(true);
    expect(result.fromScopeId).toBe("scope:original");
    expect(result.fromScopeLabel).toBe("OCT 主机问题");
    expect(result.fromPlanId).toBe("plan-1");
    expect(result.toPlanId).toBe(session.planId);
    expect(result.toScopeId).toMatch(/^scope:/);
    expect(result.toScopeLabel).toBe("无纺布来料不合格");

    expect(session.currentTaskScopeId).toBe(result.toScopeId);
    expect(result.toPlanId).not.toBe("plan-1");
    expect(session.latestDraft).toBeUndefined();
    expect(session.latestAssignment).toBeUndefined();
    expect(session.knownFacts).toEqual([]);

    const archived = session.taskScopes?.["scope:original"];
    expect(archived?.planId).toBe("plan-1");
    expect(archived?.latestDraft).toMatchObject({ title: "OCT 主机 U 盘" });
    expect(archived?.knownFacts).toEqual(["上下文 OCT 设备型号 K5"]);

    const audit = session.scopeAuditTrail ?? [];
    expect(audit.some((e) => e.eventType === "SCOPE_CREATED" && e.toScopeId === result.toScopeId)).toBe(true);
  });

  it("calls onSessionMutated after successful scope switch", () => {
    const session = makeSession({
      knownFacts: ["旧 scope 事实"],
      latestDraft: { title: "旧草案", tasks: [] },
    });
    let mutated: PlanSession | undefined;
    const handler = buildStartNewTaskHandler({
      currentSession: session,
      onSessionMutated: (s) => {
        mutated = s;
      },
    });
    const result = handler({ scopeLabel: "新任务" }) as any;
    expect(result.ok).toBe(true);
    expect(mutated).toBe(session);
    expect(mutated?.knownFacts).toEqual([]);
    expect(mutated?.latestDraft).toBeUndefined();
  });
});
