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
    notifyManagerOfEmployeeAction: vi.fn(async () => ({
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
    // get_current_time 已从 planner/manager/admin 下线（日期由 system context 注入）。
    expect(registry.get_current_time).toBeUndefined();
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

  it("redirects search_employees to roster flow while a roster is pending, without consuming quota", async () => {
    const session = {
      chatKeyHash: "hash",
      planId: "plan-roster",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      senderStaffId: "manager-1",
      knownFacts: [],
      conversationHistory: [],
      // 主管刚上传花名册，尚未被 read_uploaded_roster_text 消费。
      pendingRosterText: "张三 研发部 资深工程师\n李四 测试部 测试经理",
      pendingRosterSource: "uploaded:roster.md",
    };
    const registry = buildToolRegistry({
      employeeRepo: { list: () => [] },
      toolProfile: "manager",
      trustedActorUserId: "manager-1",
      currentSession: session,
      // 提供点将意图，确保 pre-draft gate 放行，能命中 roster 重定向逻辑。
      orchestratorUserMessage: "按这份名单把任务指派下去",
    });

    // 调用 5 次（> search quota 3）。若 quota 被消耗，第 4 次起应返回
    // search_employees_quota_exhausted；实际应每次都返回 roster 重定向，证明
    // 重定向发生在 quota 计数之前、且完全不扣额度。
    for (let i = 0; i < 5; i += 1) {
      const res = (await registry.search_employees.handler({
        name: `候选${i}`,
      })) as { ok?: boolean; reason?: string };
      expect(res.ok).toBe(false);
      expect(res.reason).toBe("pending_roster_use_resolve");
    }

    // 花名册被消费后（pendingRosterText 清空），重定向不再触发。
    (session as { pendingRosterText?: string }).pendingRosterText = undefined;
    const afterConsume = (await registry.search_employees.handler({
      name: "张三",
    })) as { reason?: string };
    expect(afterConsume.reason).not.toBe("pending_roster_use_resolve");
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

  it("excludes project portfolio tools when portfolio disabled", () => {
    vi.stubEnv("WORKBENCH_PROJECT_PORTFOLIO_USER_IDS", "portfolio-only");
    const registry = buildToolRegistry({
      employeeRepo: { list: () => [] },
      toolProfile: "manager",
      trustedActorUserId: "manager-baseline",
      projectPortfolioEnabled: false,
    });
    expect(registry.list_projects).toBeUndefined();
    expect(registry.suggest_project).toBeUndefined();
    vi.unstubAllEnvs();
  });

  it("includes project portfolio tools for portfolio manager", () => {
    vi.stubEnv("WORKBENCH_PROJECT_PORTFOLIO_USER_IDS", "portfolio-mgr");
    const registry = buildToolRegistry({
      employeeRepo: { list: () => [] },
      toolProfile: "manager",
      trustedActorUserId: "portfolio-mgr",
      projectPortfolioEnabled: true,
    });
    expect(registry.list_projects).toBeDefined();
    expect(registry.create_project).toBeDefined();
    vi.unstubAllEnvs();
  });
});
