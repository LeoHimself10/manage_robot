import { afterEach, describe, expect, it, vi } from "vitest";
import {
  extractStructuredDraftFromMessage,
  looksLikeTaskDraftMessage,
  readDraftFallbackEnabled,
} from "../../../src/agent/demo/draft-fallback-extract";

describe("draft-fallback-extract", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.DRAFT_FALLBACK_EXTRACT_ENABLED;
    delete process.env.DRAFT_FALLBACK_EXTRACT_MODEL;
    delete process.env.DRAFT_FALLBACK_MAX_TOKENS;
    delete process.env.DRAFT_FALLBACK_TIMEOUT_MS;
  });

  it("readDraftFallbackEnabled defaults on", () => {
    delete process.env.DRAFT_FALLBACK_EXTRACT_ENABLED;
    expect(readDraftFallbackEnabled()).toBe(true);
    process.env.DRAFT_FALLBACK_EXTRACT_ENABLED = "0";
    expect(readDraftFallbackEnabled()).toBe(false);
  });

  it("looksLikeTaskDraftMessage detects OCT-style draft markdown", () => {
    const md = [
      "### 任务草案：OCT导管",
      "",
      "#### 子任务拆解：",
      "",
      "| ID | 子任务标题 | 负责人 | 截止时间 | 关键动作 |",
      "| :--- | :--- | :--- | :--- | :--- |",
      "| **task_1** | **收集** | **张三** | 2026-05-25 | 动作 |",
      "| **task_2** | **分析** | **李四** | 2026-05-28 | 动作 |",
      "",
      "**目标**：查明根因。",
    ].join("\n");
    expect(looksLikeTaskDraftMessage(md)).toBe(true);
  });

  it("looksLikeTaskDraftMessage rejects short archive echo", () => {
    expect(looksLikeTaskDraftMessage("[system_note] 已归档")).toBe(false);
    expect(looksLikeTaskDraftMessage("已切换到新任务规划")).toBe(false);
  });

  it("looksLikeTaskDraftMessage rejects empty and chit-chat", () => {
    expect(looksLikeTaskDraftMessage("")).toBe(false);
    expect(looksLikeTaskDraftMessage("你好")).toBe(false);
  });

  it("looksLikeTaskDraftMessage matches 行动草案 headings without Markdown table", () => {
    const md = [
      "以下是为您规划的分析与行动草案：",
      "",
      "子任务分配建议：",
      "",
      "task_1: 供应商现场制程审核",
      "task_2: 联合技术攻关与整改验证",
      "",
      "需要您确认的信息：",
      "期望完成时间：？",
      "更多说明行。",
      "再一行。",
      "再一行。",
      "再一行。",
      "再一行。",
    ].join("\n");
    expect(looksLikeTaskDraftMessage(md)).toBe(true);
  });

  it("extractStructuredDraftFromMessage returns coerced draft on valid JSON", async () => {
    const payload = {
      title: "T1",
      description: "D1",
      tasks: [
        {
          id: "task_1",
          title: "A",
          objective: "O",
          deliverables: ["x"],
          completionCriteria: ["c"],
          inputMaterials: ["m"],
          actions: ["act"],
          collaborators: ["王五"],
          scope: { inScope: ["s1"], outOfScope: ["o1"] },
          dependencyTaskIds: [],
          risksAndOpenQuestions: ["r"],
          timeNode: { dueAt: "待确认", checkpoints: ["p1"] },
          feedbackFrequency: "每日",
        },
      ],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        ({
          ok: true,
          json: async () => ({
            choices: [{ message: { content: JSON.stringify(payload) } }],
          }),
        }) as Response
      ),
    );
    const out = await extractStructuredDraftFromMessage({
      message: "### 草案\n| ID | 子任务 |\n| task_1 | A |",
      modelConfig: { apiKey: "k", baseUrl: "https://example.com/v1" },
      traceId: "t-1",
    });
    expect(out).not.toBeNull();
    expect(out?.title).toBe("T1");
    expect(Array.isArray(out?.tasks)).toBe(true);
    expect((out?.tasks as unknown[]).length).toBe(1);
    const t0 = (out?.tasks as unknown as Array<Record<string, unknown>>)[0]!;
    expect(t0.collaborators).toEqual(["王五"]);
    expect((t0.scope as { inScope: string[] }).inScope).toEqual(["s1"]);
  });

  it("extractStructuredDraftFromMessage returns null on bad JSON", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        ({
          ok: true,
          json: async () => ({
            choices: [{ message: { content: "not-json" } }],
          }),
        }) as Response
      ),
    );
    const out = await extractStructuredDraftFromMessage({
      message: "| ID | 子任务 |\n| task_1 | A |\n**bold**",
      modelConfig: { apiKey: "k", baseUrl: "https://example.com/v1" },
    });
    expect(out).toBeNull();
  });
});
