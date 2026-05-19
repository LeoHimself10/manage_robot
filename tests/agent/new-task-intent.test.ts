import { describe, expect, it } from "vitest";
import {
  deriveNewTaskScopeLabel,
  hasPlanScopedContextToClear,
  isExplicitNewTaskRequest,
} from "../../src/agent/new-task-intent";

describe("new task intent helpers", () => {
  it("detects explicit new task switch commands", () => {
    expect(isExplicitNewTaskRequest("开启新任务：供应商来料异常处理")).toBe(true);
    expect(isExplicitNewTaskRequest("换个任务，帮我安排OCT排查")).toBe(true);
    expect(isExplicitNewTaskRequest("下面作为新任务：验证报告补齐")).toBe(true);
  });

  it("does not treat negated mentions as a switch", () => {
    expect(isExplicitNewTaskRequest("这不是新任务，继续刚才的")).toBe(false);
    expect(isExplicitNewTaskRequest("不用新任务，按原草案改")).toBe(false);
  });

  it("derives a compact scope label from the command", () => {
    expect(deriveNewTaskScopeLabel("开启新任务：供应商来料异常处理")).toBe("供应商来料异常处理");
    expect(deriveNewTaskScopeLabel("新任务 OCT U盘稳定性排查")).toBe("OCT U盘稳定性排查");
  });

  it("recognizes plan-scoped context that must be hidden before orchestration", () => {
    expect(hasPlanScopedContextToClear({ candidatePool: { entries: [] } })).toBe(true);
    expect(hasPlanScopedContextToClear({ pendingRosterText: "张三" })).toBe(true);
    expect(hasPlanScopedContextToClear({ conversationHistory: [] })).toBe(false);
  });
});
