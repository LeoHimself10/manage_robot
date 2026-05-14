import { afterEach, describe, expect, it, vi } from "vitest";
import { buildToolRegistry } from "../../../src/agent/tools/registry";

vi.mock("../../../src/integrations/dingtalk/workbench-notify", () => ({
  createWorkbenchPublishNotifier: () => ({
    notifyPublishedTask: vi.fn(async () => ({
      enabled: false,
      skippedReason: "off",
      success: [],
      failed: [],
    })),
    notifyReassignedAssignee: vi.fn(async () => ({
      enabled: false,
      skippedReason: "off",
      success: [],
      failed: [],
    })),
  }),
}));

describe("tool registry profiles", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("planner profile excludes employee mutation tools", () => {
    const registry = buildToolRegistry({
      employeeRepo: { list: () => [] },
      toolProfile: "planner",
      allowSearchWeb: false,
    });
    expect(registry.save_draft).toBeUndefined();
    expect(registry.search_employees).toBeDefined();
    expect(registry.list_my_tasks).toBeUndefined();
    expect(registry.submit_employee_response).toBeUndefined();
    expect(registry.search_web).toBeUndefined();
    expect(registry.get_current_time).toBeDefined();
  });

  it("employee profile includes employee tools and rejects without trusted actor", async () => {
    const registry = buildToolRegistry({
      employeeRepo: { list: () => [] },
      toolProfile: "employee",
    });
    expect(registry.list_my_tasks).toBeDefined();
    expect(registry.submit_progress_update).toBeDefined();
    expect(registry.get_current_time).toBeDefined();
    const result = await registry.list_my_tasks.handler({});
    expect(result).toEqual({
      ok: false,
      error: "trusted_actor_required",
    });
  });

  it("search_web is gated by allowSearchWeb and SEARCH_WEB_ENABLED", () => {
    vi.stubEnv("SEARCH_WEB_ENABLED", "0");
    const disabled = buildToolRegistry({
      employeeRepo: { list: () => [] },
      toolProfile: "planner",
      allowSearchWeb: true,
    });
    expect(disabled.search_web).toBeUndefined();

    vi.stubEnv("SEARCH_WEB_ENABLED", "1");
    const enabled = buildToolRegistry({
      employeeRepo: { list: () => [] },
      toolProfile: "planner",
      allowSearchWeb: true,
    });
    expect(enabled.search_web).toBeDefined();
  });

  it("manager profile includes publish_task and trusted actor is enforced", async () => {
    const registry = buildToolRegistry({
      employeeRepo: { list: () => [] },
      toolProfile: "manager",
      currentSessionPlanId: "plan-1",
      currentSession: {
        chatKeyHash: "hash",
        planId: "plan-1",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        senderStaffId: "manager-1",
        knownFacts: [],
        conversationHistory: [],
      },
    });
    expect(registry.publish_task).toBeDefined();
    const res = await registry.publish_task.handler({ planId: "plan-1" });
    expect(res).toEqual({ ok: false, error: "trusted_actor_required" });
  });

  it("search_similar_plans is gated by SEARCH_SIMILAR_PLANS_ENABLED", () => {
    vi.stubEnv("SEARCH_SIMILAR_PLANS_ENABLED", "0");
    const disabled = buildToolRegistry({
      employeeRepo: { list: () => [] },
      toolProfile: "planner",
      allowSearchWeb: false,
    });
    expect(disabled.search_similar_plans).toBeUndefined();

    vi.stubEnv("SEARCH_SIMILAR_PLANS_ENABLED", "1");
    const enabled = buildToolRegistry({
      employeeRepo: { list: () => [] },
      toolProfile: "planner",
      allowSearchWeb: false,
    });
    expect(enabled.search_similar_plans).toBeDefined();
  });

  it("admin profile includes admin tools while manager profile does not", () => {
    const adminRegistry = buildToolRegistry({
      employeeRepo: { list: () => [] },
      toolProfile: "admin",
      trustedActorUserId: "admin-1",
      actorRole: "admin",
    });
    expect(adminRegistry.admin_list_all_tasks).toBeDefined();
    expect(adminRegistry.get_metrics).toBeDefined();
    expect(adminRegistry.list_managers).toBeDefined();
    expect(adminRegistry.set_manager_permission).toBeDefined();
    expect(adminRegistry.list_managed_tasks).toBeDefined();
    expect(adminRegistry.reassign_task).toBeDefined();

    const managerRegistry = buildToolRegistry({
      employeeRepo: { list: () => [] },
      toolProfile: "manager",
      trustedActorUserId: "manager-1",
      actorRole: "manager",
    });
    expect(managerRegistry.admin_list_all_tasks).toBeUndefined();
    expect(managerRegistry.get_metrics).toBeUndefined();
    expect(managerRegistry.list_managers).toBeUndefined();
    expect(managerRegistry.set_manager_permission).toBeUndefined();
  });

  it("known facts tools are exposed only when store is provided", () => {
    const withoutFacts = buildToolRegistry({
      employeeRepo: { list: () => [] },
      toolProfile: "planner",
    });
    expect(withoutFacts.update_known_facts).toBeUndefined();
    expect(withoutFacts.list_known_facts).toBeUndefined();

    let facts: string[] = [];
    const withFacts = buildToolRegistry({
      employeeRepo: { list: () => [] },
      toolProfile: "planner",
      knownFactsStore: {
        get: () => facts,
        update: (next) => {
          facts = [...new Set([...facts, ...next])];
        },
      },
    });
    expect(withFacts.update_known_facts).toBeDefined();
    expect(withFacts.list_known_facts).toBeDefined();
  });
});
