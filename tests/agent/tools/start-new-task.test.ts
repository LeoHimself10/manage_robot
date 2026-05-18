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

  it("clears current draft and strips prior scope snapshot (no recoverable archive)", () => {
    const session = makeSession({
      conversationHistory: [
        { role: "user", content: "hi" },
        { role: "assistant", content: "bye" },
      ],
      latestDraft: { title: "OCT 主机 U 盘", tasks: [{ id: "t1", title: "现场排查" }] },
      latestAssignment: { assignments: [{ taskId: "t1", primary: { userId: "u1" } }] },
      knownFacts: ["上下文 OCT 设备型号 K5"],
    });
    const handler = buildStartNewTaskHandler({ currentSession: session });
    const result = handler({
      scopeLabel: "无纺布来料不合格",
      reason: "用户切换主题",
    }) as Record<string, unknown>;

    expect(result.ok).toBe(true);
    expect(result.fromScopeId).toBe("scope:original");
    expect(result.fromScopeLabel).toBe("OCT 主机问题");
    expect(result.fromPlanId).toBe("plan-1");
    expect(result.toPlanId).toBe(session.planId);
    expect(String(result.toScopeId ?? "")).toMatch(/^scope:/);
    expect(result.toScopeLabel).toBe("无纺布来料不合格");

    expect(session.currentTaskScopeId).toBe(result.toScopeId);
    expect(result.toPlanId).not.toBe("plan-1");
    expect(session.latestDraft).toBeUndefined();
    expect(session.latestAssignment).toBeUndefined();
    expect(session.knownFacts).toEqual([]);

    const prior = session.taskScopes?.["scope:original"];
    expect(prior?.planId).toBe("plan-1");
    expect(prior?.latestDraft).toBeUndefined();
    expect(prior?.latestAssignment).toBeUndefined();
    expect(prior?.knownFacts).toEqual([]);

    const hint = String(result.hint ?? "");
    expect(hint).toContain("已清空上一轮规划上下文");
    expect(hint).not.toMatch(/可切回|恢复|归档原任务/);

    const audit = session.scopeAuditTrail ?? [];
    expect(audit.some((e) => e.eventType === "SCOPE_CREATED" && e.toScopeId === result.toScopeId)).toBe(true);
    expect(result.clearedHistoryEntries).toBe(2);
    expect(session.conversationHistory).toHaveLength(1);
    expect(session.conversationHistory[0]!.content).toMatch(/^\[system_note\]/);
  });
});
