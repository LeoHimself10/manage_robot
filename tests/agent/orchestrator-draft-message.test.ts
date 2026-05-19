import { describe, expect, it } from "vitest";
import { recoverOrchestratorUserMessage } from "../../src/agent/orchestrator-draft-message";

describe("recoverOrchestratorUserMessage", () => {
  it("returns existing message when non-empty", () => {
    expect(
      recoverOrchestratorUserMessage({ message: "你好" }),
    ).toBe("你好");
  });

  it("recovers from raw JSON draft-only payload", () => {
    const raw = JSON.stringify({
      draft: {
        title: "测试",
        objective: "目标",
        background: "背景",
        tasks: [{ id: "t1", title: "子任务1" }],
      },
    });
    const msg = recoverOrchestratorUserMessage({ message: "", rawContent: raw });
    expect(msg).toContain("已生成任务草案");
    expect(msg).toContain("测试");
  });

  it("suggests continuation after update_known_facts only", () => {
    const msg = recoverOrchestratorUserMessage({
      message: "",
      toolInvocationNames: ["update_known_facts"],
    });
    expect(msg).toContain("已记录您补充的信息");
  });

  it("suggests roster action after many search_employees", () => {
    const msg = recoverOrchestratorUserMessage({
      message: "",
      toolInvocationNames: [
        "update_known_facts",
        "search_employees",
        "search_employees",
        "search_employees",
      ],
    });
    expect(msg).toContain("人员检索");
  });
});
