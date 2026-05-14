import { describe, expect, it } from "vitest";
import {
  buildClearCandidatePoolHandler,
  buildListCandidatePoolHandler,
  buildReadUploadedRosterTextHandler,
  buildSetCandidatePoolHandler,
} from "../../../src/agent/tools/candidate-pool";
import type { PlanSession } from "../../../src/infra/plan-session-store";
import type { DingTalkContactRow } from "../../../src/infra/people-directory-store";

function makeSession(over: Partial<PlanSession> = {}): PlanSession {
  return {
    chatKeyHash: "hash",
    planId: "plan_x",
    createdAt: "2026-05-01T00:00:00Z",
    updatedAt: "2026-05-01T00:00:00Z",
    knownFacts: [],
    conversationHistory: [],
    ...over,
  };
}

function contactStub(over: Partial<DingTalkContactRow> & { userId: string }): DingTalkContactRow {
  return {
    name: "Default",
    active: true,
    departmentIds: [],
    departmentNames: [],
    ...over,
    userId: over.userId,
  } as DingTalkContactRow;
}

const directory: Record<string, DingTalkContactRow> = {
  "641000001": contactStub({ userId: "641000001", name: "张三", active: true }),
  "641000002": contactStub({ userId: "641000002", name: "李四", active: true }),
  "641000003": contactStub({ userId: "641000003", name: "王五", active: false }),
};

const getContact = (userId: string) => directory[userId];

describe("read_uploaded_roster_text", () => {
  it("returns ok:false when no pending roster", () => {
    const session = makeSession();
    const handler = buildReadUploadedRosterTextHandler({ currentSession: session, getContact });
    const r = handler({}) as Record<string, unknown>;
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("no_pending_roster");
  });

  it("returns text once and clears pending state", () => {
    const session = makeSession({
      pendingRosterText: "张三\n李四",
      pendingRosterSource: "uploaded:roster.md",
    });
    let mutated = false;
    const handler = buildReadUploadedRosterTextHandler({
      currentSession: session,
      getContact,
      onSessionMutated: () => {
        mutated = true;
      },
    });
    const first = handler({}) as Record<string, unknown>;
    expect(first.ok).toBe(true);
    expect(first.text).toBe("张三\n李四");
    expect(first.sourceLabel).toBe("uploaded:roster.md");
    expect(mutated).toBe(true);
    expect(session.pendingRosterText).toBeUndefined();
    expect(session.pendingRosterSource).toBeUndefined();
    // 二次调用 → 已被消费
    const second = handler({}) as Record<string, unknown>;
    expect(second.ok).toBe(false);
    expect(second.reason).toBe("no_pending_roster");
  });
});

describe("set_candidate_pool", () => {
  it("accepts valid contacts and rejects non-directory or inactive", () => {
    const session = makeSession();
    const handler = buildSetCandidatePoolHandler({ currentSession: session, getContact });
    const r = handler({
      source: "uploaded:roster.md",
      entries: [
        { userId: "641000001", displayName: "张三", fileNotes: "质量负责人" },
        { userId: "641000002" },
        { userId: "641000003", displayName: "王五" }, // inactive → rejected
        { userId: "999999999" }, // not in directory → rejected
        { userId: "" }, // missing userId
      ],
      unresolved: [{ rawName: "陈某某", hint: "可能是新人" }],
    }) as Record<string, unknown>;
    expect(r.ok).toBe(true);
    expect(session.candidatePool).toBeDefined();
    expect(session.candidatePool?.entries).toHaveLength(2);
    expect(session.candidatePool?.entries[0]?.userId).toBe("641000001");
    expect(session.candidatePool?.entries[0]?.fileNotes).toBe("质量负责人");
    expect(session.candidatePool?.entries[1]?.displayName).toBe("李四"); // fallback to contact name
    expect(session.candidatePool?.unresolved).toHaveLength(1);
    expect(session.candidatePool?.unresolved?.[0]?.rawName).toBe("陈某某");
    const rejected = (r as { rejected: Array<{ userId: string; reason: string }> }).rejected;
    expect(rejected).toHaveLength(3);
    expect(rejected.find((row) => row.userId === "641000003")?.reason).toBe("contact_inactive");
    expect(rejected.find((row) => row.userId === "999999999")?.reason).toBe("not_in_dingtalk_contacts");
    expect(rejected.find((row) => row.userId === "")?.reason).toBe("missing_userId");
  });

  it("returns ok:false when all entries are rejected", () => {
    const session = makeSession();
    const handler = buildSetCandidatePoolHandler({ currentSession: session, getContact });
    const r = handler({
      entries: [{ userId: "ghost1" }, { userId: "ghost2" }],
    }) as Record<string, unknown>;
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("all_entries_rejected");
    expect(session.candidatePool).toBeUndefined();
  });

  it("dedups same userId in one batch", () => {
    const session = makeSession();
    const handler = buildSetCandidatePoolHandler({ currentSession: session, getContact });
    handler({
      entries: [
        { userId: "641000001" },
        { userId: "641000001", displayName: "张三 (重复)" },
      ],
    });
    expect(session.candidatePool?.entries).toHaveLength(1);
  });

  it("inherits source from previous pool when not provided", () => {
    const session = makeSession({
      candidatePool: {
        source: "uploaded:old.md",
        entries: [{ userId: "641000001", displayName: "张三" }],
        updatedAt: "2026-04-01T00:00:00Z",
      },
    });
    const handler = buildSetCandidatePoolHandler({ currentSession: session, getContact });
    handler({ entries: [{ userId: "641000002" }] });
    expect(session.candidatePool?.source).toBe("uploaded:old.md");
    expect(session.candidatePool?.entries[0]?.userId).toBe("641000002");
  });
});

describe("clear_candidate_pool", () => {
  it("returns alreadyEmpty when there is no pool", () => {
    const session = makeSession();
    const handler = buildClearCandidatePoolHandler({ currentSession: session, getContact });
    const r = handler({}) as Record<string, unknown>;
    expect(r.ok).toBe(true);
    expect(r.alreadyEmpty).toBe(true);
  });

  it("clears the pool and reports previous source", () => {
    const session = makeSession({
      candidatePool: {
        source: "uploaded:r.md",
        entries: [{ userId: "641000001", displayName: "张三" }],
        updatedAt: "2026-04-01T00:00:00Z",
      },
    });
    const handler = buildClearCandidatePoolHandler({ currentSession: session, getContact });
    const r = handler({ reason: "redo" }) as Record<string, unknown>;
    expect(r.ok).toBe(true);
    expect(r.cleared).toBe(true);
    expect(r.previousSource).toBe("uploaded:r.md");
    expect(r.previousEntriesCount).toBe(1);
    expect(session.candidatePool).toBeUndefined();
  });
});

describe("list_candidate_pool", () => {
  it("reports hasPool=false when empty", () => {
    const session = makeSession();
    const handler = buildListCandidatePoolHandler({ currentSession: session, getContact });
    const r = handler({}) as Record<string, unknown>;
    expect(r.ok).toBe(true);
    expect(r.hasPool).toBe(false);
  });

  it("returns entries snapshot when pool exists", () => {
    const session = makeSession({
      candidatePool: {
        source: "uploaded:r.md",
        entries: [
          { userId: "641000001", displayName: "张三", fileNotes: "QA" },
          { userId: "641000002", displayName: "李四" },
        ],
        unresolved: [{ rawName: "陈某" }],
        updatedAt: "2026-04-01T00:00:00Z",
      },
    });
    const handler = buildListCandidatePoolHandler({ currentSession: session, getContact });
    const r = handler({}) as { ok: boolean; hasPool: boolean; pool: Record<string, unknown> };
    expect(r.ok).toBe(true);
    expect(r.hasPool).toBe(true);
    const entries = r.pool.entries as Array<Record<string, unknown>>;
    expect(entries).toHaveLength(2);
    expect(entries[0]?.fileNotes).toBe("QA");
    expect((r.pool.unresolved as unknown[]).length).toBe(1);
  });
});
