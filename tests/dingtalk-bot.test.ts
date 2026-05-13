import { describe, expect, it } from "vitest";
import { appendPublishSummaryMarkdown, shouldUseAnonymousSession } from "../src/dingtalk-bot";
import { buildToolRegistry } from "../src/agent/tools/registry";

describe("dingtalk bot helpers", () => {
  it("uses anonymous session when senderStaffId is empty", () => {
    expect(shouldUseAnonymousSession("")).toBe(true);
    expect(shouldUseAnonymousSession("   ")).toBe(true);
    expect(shouldUseAnonymousSession("manager-1")).toBe(false);
  });

  it("appends publish summary for fresh publish", () => {
    const output = appendPublishSummaryMarkdown("草案已准备", {
      ok: true,
      alreadyPublished: false,
      task: { taskNo: "W20260513001", title: "测试任务" },
      subtasks: [
        { assigneeUserId: "emp-1", title: "A" },
        { assigneeUserId: "emp-2", title: "B" },
      ],
      warnings: [],
    });
    expect(output).toContain("【已发布】任务编号 W20260513001");
    expect(output).toContain("子任务 2 个 → 已通知 2 名员工");
  });

  it("appends already published summary when publish is duplicated", () => {
    const output = appendPublishSummaryMarkdown("草案已准备", {
      ok: true,
      alreadyPublished: true,
      task: { taskNo: "W20260513001", title: "测试任务" },
    });
    expect(output).toContain("此计划已发布过");
    expect(output).toContain("W20260513001");
  });

  it("known facts store can be updated through registry tools", async () => {
    let facts: string[] = ["旧事实"];
    const registry = buildToolRegistry({
      employeeRepo: { list: () => [] },
      toolProfile: "planner",
      knownFactsStore: {
        get: () => facts,
        update: (next) => {
          facts = [...new Set([...facts, ...next])];
        },
      },
    });
    await registry.update_known_facts.handler({ facts: ["新事实"] });
    expect(facts).toContain("新事实");
  });
});
