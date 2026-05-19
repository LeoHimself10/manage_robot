import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildMatchRosterToContactsHandler } from "../../../src/agent/tools/match-roster-to-contacts";
import type { PlanSession } from "../../../src/infra/plan-session-store";
import type { DingTalkContactRow } from "../../../src/infra/people-directory-store";

const mockSearchContacts = vi.fn();

vi.mock("../../../src/infra/people-directory-store", () => ({
  createPeopleDirectoryStore: () => ({
    searchContacts: mockSearchContacts,
    close: () => {},
  }),
}));

function makeSession(over: Partial<PlanSession> = {}): PlanSession {
  return {
    chatKeyHash: "hash",
    planId: "plan_roster",
    createdAt: "2026-05-01T00:00:00Z",
    updatedAt: "2026-05-01T00:00:00Z",
    knownFacts: [],
    conversationHistory: [],
    ...over,
  };
}

function contact(userId: string, name: string): DingTalkContactRow {
  return {
    userId,
    name,
    active: true,
    departmentIds: [],
    departmentNames: ["质量部"],
  } as DingTalkContactRow;
}

const directory: Record<string, DingTalkContactRow> = {
  "641100001": contact("641100001", "杨楚榛"),
  "641100002": contact("641100002", "杨贺新"),
  "641100003": contact("641100003", "陈哲治"),
};

describe("match_roster_to_contacts", () => {
  beforeEach(() => {
    mockSearchContacts.mockImplementation((keyword: string) => {
      const k = keyword.trim();
      return Object.values(directory).filter((c) => c.name.includes(k) || k.includes(c.name));
    });
  });

  afterEach(() => {
    mockSearchContacts.mockReset();
  });

  it("matches names from pending roster and writes candidate pool", () => {
    const rosterText = readFileSync(
      join(process.cwd(), "fixtures/sample-roster-杨楚臻-杨贺新-陈哲治-测试.md"),
      "utf8",
    );
    const session = makeSession({
      pendingRosterText: rosterText,
      pendingRosterSource: "uploaded:roster.md",
    });
    const handler = buildMatchRosterToContactsHandler({
      currentSession: session,
      getContact: (id) => directory[id],
    });
    const res = handler({ fromPendingRoster: true }) as Record<string, unknown>;
    expect(res.ok).toBe(true);
    expect(res.candidatePoolApplied).toBe(true);
    expect(session.pendingRosterText).toBeUndefined();
    expect(session.candidatePool?.entries).toHaveLength(3);
    expect(session.candidatePool?.entries.map((e) => e.displayName)).toEqual([
      "杨楚榛",
      "杨贺新",
      "陈哲治",
    ]);
    const matched = res.matched as Array<{ inputName: string }>;
    expect(matched.map((m) => m.inputName)).toEqual(["杨楚榛", "杨贺新", "陈哲治"]);
    expect(mockSearchContacts).toHaveBeenCalled();
  });

  it("returns unresolved when name not found", () => {
    mockSearchContacts.mockReturnValue([]);
    const session = makeSession();
    const handler = buildMatchRosterToContactsHandler({
      currentSession: session,
      getContact: (id) => directory[id],
    });
    const res = handler({ names: ["不存在的人"] }) as Record<string, unknown>;
    expect(res.ok).toBe(true);
    expect((res.unresolved as unknown[]).length).toBe(1);
    expect(res.candidatePoolApplied).toBeFalsy();
  });

  it("returns ambiguous when multiple hits", () => {
    mockSearchContacts.mockReturnValue([
      directory["641100001"],
      directory["641100002"],
    ]);
    const session = makeSession();
    const handler = buildMatchRosterToContactsHandler({
      currentSession: session,
      getContact: (id) => directory[id],
    });
    const res = handler({ names: ["杨"] }) as Record<string, unknown>;
    expect(res.ok).toBe(true);
    const unresolved = res.unresolved as Array<{ reason: string }>;
    expect(unresolved[0]?.reason).toBe("ambiguous");
  });

  it("returns no_names when empty input", () => {
    const session = makeSession();
    const handler = buildMatchRosterToContactsHandler({
      currentSession: session,
      getContact: (id) => directory[id],
    });
    const res = handler({}) as Record<string, unknown>;
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("no_names");
  });
});
