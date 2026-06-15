import { describe, expect, it } from "vitest";
import type { PlanSession } from "../../../src/infra/plan-session-store";
import type { DingTalkContactRow } from "../../../src/infra/people-directory-store";
import {
  buildAssignFromRosterHandler,
  parseRosterSections,
} from "../../../src/agent/v2/assign-from-roster-tool";

const ROSTER_MD = `# 候选名单

> 背景说明若干。

## 姚雪峰

| 项目 | 说明 |
|------|------|
| 部门/岗位 | 研发部 / 硬件测试工程师 |
| 技能标签 | 上电时序、蓝屏日志 |

## 杨贺新

| 项目 | 说明 |
|------|------|
| 部门/岗位 | 研发部 / 结构工程师 |
| 技能标签 | 运输包装、减震缓冲 |

## 使用提示

- 这一段不是人名，不应入池。
`;

const CONTACTS: Record<string, DingTalkContactRow> = {
  "u-yxf": { userId: "u-yxf", name: "姚雪峰", active: true } as DingTalkContactRow,
  "u-yhx": { userId: "u-yhx", name: "杨贺新", active: true } as DingTalkContactRow,
};

function searchContacts(keyword: string): DingTalkContactRow[] {
  return Object.values(CONTACTS).filter((c) => String(c.name).includes(keyword));
}

function getContact(userId: string): DingTalkContactRow | undefined {
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
      title: "草案",
      tasks: [
        { id: "task_1", title: "子任务1" },
        { id: "task_2", title: "子任务2" },
      ],
    },
    ...overrides,
  } as PlanSession;
}

describe("parseRosterSections", () => {
  it("extracts name headings with compacted fileNotes; skips non-name headings", () => {
    const sections = parseRosterSections(ROSTER_MD);
    expect(sections.map((s) => s.name)).toEqual(["姚雪峰", "杨贺新"]);
    expect(sections[0].fileNotes).toContain("硬件测试工程师");
    expect(sections[0].fileNotes).toContain("蓝屏日志");
    expect(sections[0].fileNotes).not.toContain("项目: 说明");
    expect(sections[1].fileNotes).toContain("结构工程师");
  });

  it("returns empty for text without name headings", () => {
    expect(parseRosterSections("随便一段没有标题的文字")).toEqual([]);
  });
});

describe("buildAssignFromRosterHandler", () => {
  it("pool absent + pending roster → builds pool with fileNotes then assigns full table", () => {
    const session = makeSession({
      pendingRosterText: ROSTER_MD,
      pendingRosterSource: "uploaded:roster.md",
    });
    const mutatedSnapshots: Array<{ hasPool: boolean; hasAssignment: boolean }> = [];
    const handler = buildAssignFromRosterHandler({
      currentSession: session,
      onSessionMutated: (s) => {
        mutatedSnapshots.push({
          hasPool: (s.candidatePool?.entries?.length ?? 0) > 0,
          hasAssignment: s.latestAssignment != null,
        });
      },
      getContact,
      searchContacts,
    });

    const result = handler({
      assignments: [
        { taskId: "task_1", assigneeName: "姚雪峰" },
        { taskId: "task_2", assigneeName: "杨贺新" },
      ],
    }) as Record<string, unknown>;

    expect(result.ok).toBe(true);
    expect(result.poolBuilt).toBe(true);
    expect(session.candidatePool?.entries.map((e) => e.userId)).toEqual(["u-yxf", "u-yhx"]);
    expect(
      session.candidatePool?.entries.every((e) => (e.fileNotes ?? "").length > 0),
    ).toBe(true);
    // roster text consumed (same semantics as read_uploaded_roster_text)
    expect(session.pendingRosterText).toBeUndefined();
    // assignment written for both rows (scheme C: latestAssignment.assignments[].primary)
    const assignment = session.latestAssignment as {
      assignments?: Array<{ taskId: string; primary?: { userId?: string } }>;
    };
    const byTask = new Map(
      (assignment?.assignments ?? []).map((a) => [a.taskId, a.primary?.userId]),
    );
    expect(byTask.get("task_1")).toBe("u-yxf");
    expect(byTask.get("task_2")).toBe("u-yhx");
    // session-mutated broadcast must happen ONCE, after both pool build and
    // assignment write (mid-flight broadcasts can lose the in-place
    // assignment write when the upstream rebinds session to a spread copy).
    expect(mutatedSnapshots).toEqual([{ hasPool: true, hasAssignment: true }]);
  });

  it("pool already built → skips building, resolves names from pool", () => {
    const session = makeSession({
      candidatePool: {
        source: "uploaded:roster.md",
        entries: [
          { userId: "u-yxf", displayName: "姚雪峰" },
          { userId: "u-yhx", displayName: "杨贺新" },
        ],
        updatedAt: new Date().toISOString(),
      } as PlanSession["candidatePool"],
    });
    const handler = buildAssignFromRosterHandler({
      currentSession: session,
      getContact,
      searchContacts,
    });

    const result = handler({
      assignments: [
        { taskId: "task_1", assigneeName: "姚雪峰" },
        { taskId: "task_2", assigneeUserId: "u-yhx" },
      ],
    }) as Record<string, unknown>;

    expect(result.ok).toBe(true);
    expect(result.poolBuilt).toBe(false);
  });

  it("no pool and no pending roster → soft error no_roster_or_pool", () => {
    const session = makeSession();
    const handler = buildAssignFromRosterHandler({
      currentSession: session,
      getContact,
      searchContacts,
    });
    const result = handler({
      assignments: [{ taskId: "task_1", assigneeName: "姚雪峰" }],
    }) as Record<string, unknown>;
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("no_roster_or_pool");
  });

  it("unknown assignee name → soft error listing pool names; pool stays built", () => {
    const session = makeSession({
      pendingRosterText: ROSTER_MD,
    });
    const handler = buildAssignFromRosterHandler({
      currentSession: session,
      getContact,
      searchContacts,
    });
    const result = handler({
      assignments: [
        { taskId: "task_1", assigneeName: "不存在的人" },
        { taskId: "task_2", assigneeName: "杨贺新" },
      ],
    }) as Record<string, unknown>;
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("unknown_assignee_names");
    expect(result.unknownNames).toEqual(["不存在的人"]);
    expect(result.poolBuilt).toBe(true);
    expect(session.candidatePool?.entries.length).toBe(2);
  });

  it("partial coverage → bulk-assign soft error bubbles up", () => {
    const session = makeSession({
      pendingRosterText: ROSTER_MD,
    });
    const handler = buildAssignFromRosterHandler({
      currentSession: session,
      getContact,
      searchContacts,
    });
    const result = handler({
      assignments: [{ taskId: "task_1", assigneeName: "姚雪峰" }],
    }) as Record<string, unknown>;
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("partial_assignment");
    expect(result.poolBuilt).toBe(true);
  });
});
