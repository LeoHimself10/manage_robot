import { describe, expect, it } from "vitest";
import { buildToolRegistry } from "../../../src/agent/tools/registry";
import {
  buildPreDraftGateResponse,
  shouldBlockPreDraftTool,
} from "../../../src/agent/registry-pre-draft-gate";
import type { PlanSession } from "../../../src/infra/plan-session-store";

describe("registry pre-draft gate", () => {
  it("blocks search_employees without draft or assign intent", () => {
    expect(
      shouldBlockPreDraftTool({
        session: {} as PlanSession,
        userMessage: USB_DESC,
        toolName: "search_employees",
        args: {},
      }),
    ).toBe(true);
    const resp = buildPreDraftGateResponse("search_employees");
    expect(resp.ok).toBe(false);
    expect(resp.reason).toBe("search_before_draft");
  });

  it("allows search_employees when draft exists", () => {
    expect(
      shouldBlockPreDraftTool({
        session: {
          latestDraft: { tasks: [{ id: "task_1", title: "t" }] },
        } as PlanSession,
        userMessage: USB_DESC,
        toolName: "search_employees",
        args: {},
      }),
    ).toBe(false);
  });

  it("allows search_employees with name arg even without draft", () => {
    expect(
      shouldBlockPreDraftTool({
        session: {} as PlanSession,
        userMessage: USB_DESC,
        toolName: "search_employees",
        args: { name: "张三" },
      }),
    ).toBe(false);
  });

  it("registry handler returns soft reject for search_employees pre-draft", async () => {
    const registry = buildToolRegistry({
      employeeRepo: { list: () => [] },
      toolProfile: "planner",
      orchestratorUserMessage: USB_DESC,
      currentSession: {} as PlanSession,
    });
    const result = await registry.search_employees.handler({});
    expect(result).toMatchObject({
      ok: false,
      reason: "search_before_draft",
    });
  });

  it("blocks update_known_facts and search_similar_plans without draft", () => {
    expect(
      shouldBlockPreDraftTool({
        session: {} as PlanSession,
        userMessage: USB_DESC,
        toolName: "update_known_facts",
      }),
    ).toBe(true);
    expect(
      shouldBlockPreDraftTool({
        session: {} as PlanSession,
        userMessage: USB_DESC,
        toolName: "search_similar_plans",
      }),
    ).toBe(true);
  });
});

const USB_DESC =
  "产线 U 盘读写异常，需要排查根因并制定纠正措施，涉及多部门协作。";
