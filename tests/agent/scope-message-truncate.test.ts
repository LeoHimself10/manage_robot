import { describe, expect, it } from "vitest";
import {
  applyScopeSwitchToRuntimeMessages,
  isScopeSwitchToolOk,
  readScopeSwitchPlanId,
  refreshMemoryContextAfterScopeSwitch,
  truncateMessagesAfterScopeSwitch,
} from "../../src/agent/scope-message-truncate";

describe("scope-message-truncate", () => {
  describe("isScopeSwitchToolOk", () => {
    it("true for ok start_new_task / switch_back_task", () => {
      expect(isScopeSwitchToolOk("start_new_task", { ok: true, toPlanId: "p2" })).toBe(true);
      expect(isScopeSwitchToolOk("switch_back_task", { ok: true })).toBe(true);
    });
    it("false for failed or unrelated tools", () => {
      expect(isScopeSwitchToolOk("start_new_task", { ok: false })).toBe(false);
      expect(isScopeSwitchToolOk("search_employees", { ok: true })).toBe(false);
    });
  });

  describe("readScopeSwitchPlanId", () => {
    it("reads toPlanId", () => {
      expect(readScopeSwitchPlanId({ ok: true, toPlanId: "plan-new" })).toBe("plan-new");
    });
    it("undefined when missing", () => {
      expect(readScopeSwitchPlanId({ ok: true })).toBeUndefined();
    });
  });

  describe("truncateMessagesAfterScopeSwitch", () => {
    it("drops persisted history between memory and current user turn", () => {
      const messages: Array<Record<string, unknown>> = [
        { role: "system", content: "sys" },
        { role: "assistant", content: "[memory_context]\nplanId: old" },
        { role: "user", content: "old turn 1" },
        { role: "assistant", content: "old reply 1" },
        { role: "user", content: "current user request" },
        { role: "assistant", content: "", tool_calls: [{ id: "tc1" }] },
        { role: "tool", tool_call_id: "tc1", content: "{}" },
      ];
      truncateMessagesAfterScopeSwitch(messages);
      expect(messages.map((m) => m.role)).toEqual([
        "system",
        "assistant",
        "user",
        "assistant",
        "tool",
      ]);
      expect(messages[2].content).toBe("current user request");
    });

    it("no-op when no middle history", () => {
      const messages: Array<Record<string, unknown>> = [
        { role: "system", content: "sys" },
        { role: "user", content: "only user" },
      ];
      const before = messages.length;
      truncateMessagesAfterScopeSwitch(messages);
      expect(messages.length).toBe(before);
    });
  });

  describe("refreshMemoryContextAfterScopeSwitch", () => {
    it("strips stale draft/assignment/candidate hints and updates planId", () => {
      const messages: Array<Record<string, unknown>> = [
        { role: "system", content: "sys" },
        {
          role: "assistant",
          content: [
            "[memory_context]",
            "planId: old-plan",
            "latestDraftSummary: {\"tasks\":[]}",
            "latestAssignmentSummary: 宋元勋",
            "candidatePool: 3 entries",
            "knownFact: 测评组倾向",
          ].join("\n"),
        },
      ];
      refreshMemoryContextAfterScopeSwitch(messages, "plan-new");
      const mem = String(messages[1].content);
      expect(mem).toContain("planId: plan-new");
      expect(mem).not.toContain("latestDraftSummary:");
      expect(mem).not.toContain("latestAssignmentSummary");
      expect(mem).not.toContain("candidatePool");
      expect(mem).toContain("knownFact: 测评组倾向");
    });
  });

  describe("applyScopeSwitchToRuntimeMessages", () => {
    it("truncates and refreshes memory when scope tool ok", () => {
      const messages: Array<Record<string, unknown>> = [
        { role: "system", content: "sys" },
        {
          role: "assistant",
          content: "[memory_context]\nplanId: old\nlatestDraftSummary: stale",
        },
        { role: "user", content: "old" },
        { role: "assistant", content: "old assistant" },
        { role: "user", content: "new task please" },
        { role: "assistant", content: "", tool_calls: [{ id: "tc1" }] },
        { role: "tool", tool_call_id: "tc1", content: "{}" },
      ];
      const rotated = applyScopeSwitchToRuntimeMessages(messages, [
        {
          toolName: "start_new_task",
          result: { ok: true, toPlanId: "plan-rotated" },
        },
      ]);
      expect(rotated).toBe(true);
      expect(messages.some((m) => m.content === "old assistant")).toBe(false);
      expect(String(messages[1].content)).toContain("planId: plan-rotated");
      expect(String(messages[1].content)).not.toContain("latestDraftSummary:");
    });

    it("returns false when no scope switch ok", () => {
      const messages: Array<Record<string, unknown>> = [
        { role: "user", content: "x" },
      ];
      expect(
        applyScopeSwitchToRuntimeMessages(messages, [
          { toolName: "search_employees", result: { ok: true, candidates: [] } },
        ]),
      ).toBe(false);
    });
  });
});
