import { afterEach, describe, expect, it } from "vitest";
import {
  splitLinesToSubtasks,
  structureTasksFromText,
} from "../../../src/agent/task-intake/structure-input";
import { __setTaskIntakeLlmForTest } from "../../../src/agent/task-intake/task-intake-llm";

afterEach(() => {
  __setTaskIntakeLlmForTest(undefined);
});

describe("task-intake structure-input", () => {
  it("faithfully maps N items to N subtasks via LLM without merging", async () => {
    __setTaskIntakeLlmForTest(async () =>
      JSON.stringify({
        parentTitle: "注册申报准备",
        parentDescription: "本周注册任务",
        subtasks: [
          { title: "整理临床资料", assigneeName: "张三", dueAt: "2026-06-10" },
          { title: "撰写技术要求" },
          { title: "提交体系核查申请", assigneeName: "李四" },
        ],
      }),
    );
    const res = await structureTasksFromText({ pastedText: "1. 整理临床资料\n2. 撰写技术要求\n3. 提交体系核查申请" });
    expect(res.usedFallback).toBe(false);
    expect(res.structured.subtasks).toHaveLength(3);
    expect(res.structured.subtasks[0].title).toBe("整理临床资料");
    expect(res.structured.subtasks[0].assigneeName).toBe("张三");
    expect(res.structured.subtasks[1].assigneeName).toBeUndefined();
  });

  it("captures optional deliverables / completionCriteria / actions / dependsOn when present", async () => {
    __setTaskIntakeLlmForTest(async () =>
      JSON.stringify({
        parentTitle: "上线准备",
        subtasks: [
          {
            title: "联调",
            deliverables: "联调报告",
            completionCriteria: "全部用例通过",
            actions: "拉测试环境；跑回归",
            dependsOn: "task_0",
          },
          { title: "无附加字段" },
        ],
      }),
    );
    const res = await structureTasksFromText({ pastedText: "联调\n无附加字段" });
    expect(res.structured.subtasks[0].deliverables).toBe("联调报告");
    expect(res.structured.subtasks[0].completionCriteria).toBe("全部用例通过");
    expect(res.structured.subtasks[0].actions).toBe("拉测试环境；跑回归");
    expect(res.structured.subtasks[0].dependsOn).toBe("task_0");
    // deliverables/completionCriteria always present (empty string when not provided by model)
    expect(res.structured.subtasks[1].deliverables).toBe("");
    expect(res.structured.subtasks[1].completionCriteria).toBe("");
    expect(res.structured.subtasks[1].actions).toBeUndefined();
  });

  it("parses self due mode with due expectation from LLM", async () => {
    __setTaskIntakeLlmForTest(async () =>
      JSON.stringify({
        parentTitle: "专项推进",
        parentDescription: "本周推进事项",
        subtasks: [
          {
            title: "输出方案初稿",
            dueMode: "self",
            dueExpectation: "三天左右",
          },
        ],
      }),
    );
    const res = await structureTasksFromText({ pastedText: "输出方案初稿" });
    expect(res.usedFallback).toBe(false);
    expect(res.structured.subtasks[0].dueMode).toBe("self");
    expect(res.structured.subtasks[0].dueExpectation).toBe("三天左右");
    expect(res.structured.subtasks[0].dueAt).toBeUndefined();
  });

  it("model always generates parentDescription and deliverables/completionCriteria even when not explicit", async () => {
    __setTaskIntakeLlmForTest(async () =>
      JSON.stringify({
        parentTitle: "注册申报准备",
        parentDescription: "完成6月注册申报所需的全部准备工作",
        subtasks: [
          {
            title: "整理临床资料",
            deliverables: "临床资料整理报告",
            completionCriteria: "所有临床资料已整理归档并确认",
          },
        ],
      }),
    );
    const res = await structureTasksFromText({ pastedText: "整理临床资料" });
    expect(res.usedFallback).toBe(false);
    expect(res.structured.parentDescription).toBeTruthy();
    expect(res.structured.subtasks[0].deliverables).toBeTruthy();
    expect(res.structured.subtasks[0].completionCriteria).toBeTruthy();
  });

  it("uses the user-provided parent title hint over the LLM title", async () => {
    __setTaskIntakeLlmForTest(async () =>
      JSON.stringify({ parentTitle: "AI起的名", subtasks: [{ title: "做一件事" }] }),
    );
    const res = await structureTasksFromText({ pastedText: "做一件事", parentTitleHint: "用户指定标题" });
    expect(res.structured.parentTitle).toBe("用户指定标题");
  });

  it("falls back to line splitting when the LLM is unavailable, fabricating no fields", async () => {
    __setTaskIntakeLlmForTest(async () => null);
    const res = await structureTasksFromText({ pastedText: "- 任务甲\n- 任务乙\n- 任务丙" });
    expect(res.usedFallback).toBe(true);
    expect(res.structured.subtasks).toHaveLength(3);
    expect(res.structured.subtasks.map((s) => s.title)).toEqual(["任务甲", "任务乙", "任务丙"]);
    expect(res.structured.subtasks[0].objective).toBeUndefined();
    expect(res.structured.subtasks[0].assigneeName).toBeUndefined();
    expect(res.warnings.some((w) => w.includes("按行拆分"))).toBe(true);
  });

  it("falls back when the LLM returns malformed content", async () => {
    __setTaskIntakeLlmForTest(async () => "not json at all");
    const res = await structureTasksFromText({ pastedText: "唯一一条任务" });
    expect(res.usedFallback).toBe(true);
    expect(res.structured.subtasks).toHaveLength(1);
    expect(res.warnings).toContain("ai_parse_failed_fallback_lines");
  });

  it("reports empty content without calling fallback", async () => {
    const res = await structureTasksFromText({ pastedText: "   " });
    expect(res.structured.subtasks).toHaveLength(0);
    expect(res.warnings).toContain("empty_content");
  });

  it("strips bullet and numbering markers in line splitter", () => {
    const subs = splitLinesToSubtasks("1. 甲\n* 乙\n- 丙\n  \n3、丁");
    expect(subs.map((s) => s.title)).toEqual(["甲", "乙", "丙", "丁"]);
  });
});
