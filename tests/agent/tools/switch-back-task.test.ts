import { describe, expect, it } from "vitest";
import { buildSwitchBackTaskHandler } from "../../../src/agent/tools/switch-back-task";
import {
  startNewTaskScope,
  type PlanSession,
} from "../../../src/infra/plan-session-store";

function makeSession(): PlanSession {
  const now = new Date().toISOString();
  // 顶层是 active scope 的视图，与 taskScopes[currentTaskScopeId] 保持一致。
  const initialDraft = { title: "OCT 主机 U 盘排查", tasks: [{ id: "t1" }] };
  return {
    chatKeyHash: "hash-1",
    planId: "plan-1",
    createdAt: now,
    updatedAt: now,
    knownFacts: [],
    conversationHistory: [],
    latestDraft: initialDraft,
    currentTaskScopeId: "scope:initial",
    taskScopes: {
      "scope:initial": {
        scopeId: "scope:initial",
        scopeLabel: "OCT 主机 U 盘",
        planId: "plan-1",
        createdAt: now,
        updatedAt: now,
        latestDraft: initialDraft,
      },
    },
  };
}

describe("switch_back_task tool", () => {
  it("fails with no_archived_scopes when only default scope exists", () => {
    const handler = buildSwitchBackTaskHandler({ currentSession: makeSession() });
    const result = handler({}) as any;
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("no_archived_scopes");
  });

  it("returns missing_query when archives exist but no query provided", () => {
    const session = makeSession();
    startNewTaskScope(session, { scopeLabel: "无纺布 KT 批次" });
    const handler = buildSwitchBackTaskHandler({ currentSession: session });
    const result = handler({}) as any;
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("missing_query");
    expect(Array.isArray(result.candidates)).toBe(true);
    expect(result.candidates.length).toBeGreaterThan(0);
  });

  it("returns scope_not_found when keyword does not match any archive", () => {
    const session = makeSession();
    startNewTaskScope(session, { scopeLabel: "无纺布 KT 批次" });
    const handler = buildSwitchBackTaskHandler({ currentSession: session });
    const result = handler({ scopeLabelKeyword: "xxx-no-match" }) as any;
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("scope_not_found");
  });

  it("restores archived scope by scopeLabelKeyword and brings back its draft", () => {
    const session = makeSession();
    const switchResult = startNewTaskScope(session, { scopeLabel: "无纺布 KT 批次" });
    expect(session.currentTaskScopeId).toBe(switchResult.toScopeId);

    session.conversationHistory = [
      { role: "user", content: "noise" },
      { role: "assistant", content: "noise2" },
    ];
    const handler = buildSwitchBackTaskHandler({ currentSession: session });
    const result = handler({ scopeLabelKeyword: "OCT" }) as any;

    expect(result.ok).toBe(true);
    expect(result.clearedHistoryEntries).toBe(2);
    expect(result.toScopeLabel).toBe("OCT 主机 U 盘");
    expect(result.toPlanId).toBe("plan-1");
    expect(result.hasDraft).toBe(true);
    expect(session.currentTaskScopeId).toBe("scope:initial");
    expect((session.latestDraft as any)?.title).toBe("OCT 主机 U 盘排查");

    const audit = session.scopeAuditTrail ?? [];
    expect(audit.some((e) => e.eventType === "SCOPE_RESTORED")).toBe(true);
  });

  it("restores by exact scopeId", () => {
    const session = makeSession();
    startNewTaskScope(session, { scopeLabel: "无纺布" });
    const handler = buildSwitchBackTaskHandler({ currentSession: session });
    const result = handler({ scopeId: "scope:initial" }) as any;
    expect(result.ok).toBe(true);
    expect(result.toScopeId).toBe("scope:initial");
  });
});
