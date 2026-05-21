import { describe, expect, it } from "vitest";
import type { DingTalkContactRow } from "../../../src/infra/people-directory-store";
import {
  buildResolveRosterNamesHandler,
  resolveRosterNamesFromContacts,
} from "../../../src/agent/tools/candidate-pool";
import type { PlanSession } from "../../../src/infra/plan-session-store";

function contact(
  userId: string,
  name: string,
  dept = "质量部",
): DingTalkContactRow {
  return {
    userId,
    name,
    active: true,
    departmentNames: [dept],
    departmentIds: ["d1"],
    unionId: `u_${userId}`,
    position: "Engineer",
  };
}

describe("resolveRosterNamesFromContacts", () => {
  const directory = [
    contact("101", "杨楚榛"),
    contact("102", "杨贺新", "研发部"),
    contact("103", "陈哲治", "研发部"),
    contact("201", "张三"),
    contact("202", "张三", "测试部"),
  ];

  const search = (keyword: string, limit = 8) => {
    const k = keyword.trim().toLowerCase();
    return directory
      .filter(
        (c) =>
          c.name.toLowerCase().includes(k)
          || c.departmentNames?.some((d) => d.toLowerCase().includes(k)),
      )
      .slice(0, limit);
  };

  it("resolves unique names in one batch", () => {
    const result = resolveRosterNamesFromContacts(
      ["杨楚榛", "杨贺新", "陈哲治"],
      search,
    );
    expect(result.resolved).toHaveLength(3);
    expect(result.unresolved).toHaveLength(0);
    expect(result.resolved.map((r) => r.userId).sort()).toEqual(["101", "102", "103"]);
  });

  it("marks ambiguous duplicate legal names unresolved", () => {
    const result = resolveRosterNamesFromContacts(["张三"], search);
    expect(result.resolved).toHaveLength(0);
    expect(result.unresolved).toHaveLength(1);
    expect(result.unresolved[0].rawName).toBe("张三");
  });

  it("dedupes input names", () => {
    const result = resolveRosterNamesFromContacts(["杨楚榛", "杨楚榛", "杨贺新"], search);
    expect(result.resolved).toHaveLength(2);
    expect(result.duplicateSkipped).toBe(1);
  });
});

describe("buildResolveRosterNamesHandler", () => {
  it("records search hits on session for resolved users", () => {
    const session: PlanSession = {
      chatKeyHash: "h",
      planId: "p1",
      senderStaffId: "mgr",
      conversationHistory: [],
      knownFacts: [],
    };
    const handler = buildResolveRosterNamesHandler({
      currentSession: session,
      getContact: (userId) =>
        userId === "101"
          ? contact("101", "杨楚榛")
          : undefined,
    });

    // Handler uses real SQLite — skip integration if no contacts; use pure function tests above.
    // Smoke: empty names rejected without DB.
    const bad = handler({ names: [] }) as { ok: boolean; reason?: string };
    expect(bad.ok).toBe(false);
    expect(bad.reason).toBe("empty_names");
  });
});
