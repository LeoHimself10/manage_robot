import { afterEach, describe, expect, it, vi } from "vitest";
import { buildToolRegistry } from "../../../src/agent/tools/registry";

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
    expect(registry.save_draft).toBeDefined();
    expect(registry.search_employees).toBeDefined();
    expect(registry.list_my_tasks).toBeUndefined();
    expect(registry.submit_employee_response).toBeUndefined();
    expect(registry.search_web).toBeUndefined();
  });

  it("employee profile includes employee tools and rejects without trusted actor", async () => {
    const registry = buildToolRegistry({
      employeeRepo: { list: () => [] },
      toolProfile: "employee",
    });
    expect(registry.list_my_tasks).toBeDefined();
    expect(registry.submit_progress_update).toBeDefined();
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
});
