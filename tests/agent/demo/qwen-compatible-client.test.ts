import { afterEach, describe, expect, it, vi } from "vitest";
import {
  QwenCompatibleClient,
  parseAssistantJsonPayload,
} from "../../../src/agent/demo/qwen-compatible-client";

describe("parseAssistantJsonPayload", () => {
  it("parses fenced json content", () => {
    const payload = parseAssistantJsonPayload(
      '```json\n{"classification":{"domain":"QUALITY","subtype":"PRODUCTION_PROCESS_ABNORMALITY","confidence":"HIGH","rationale":["x"],"missingInformation":[]},"tasks":[{"id":"task_1","title":"a","objective":"b","collaborators":[],"inputMaterials":["c"],"actions":["d"],"deliverables":["e"],"completionCriteria":["f"],"timeNode":{"checkpoints":["g"],"dueAt":"T+1"},"feedbackFrequency":"每日反馈","risksAndOpenQuestions":[],"dependencyTaskIds":[]}],"openQuestions":[]}\n```'
    ) as { classification: { domain: string }; tasks: unknown[] };

    expect(payload.classification.domain).toBe("QUALITY");
    expect(payload.tasks).toHaveLength(1);
  });
});

describe("QwenCompatibleClient", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("calls chat completions endpoint and returns trace metadata", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        id: "req_001",
        model: "qwen-plus",
        choices: [
          {
            finish_reason: "stop",
            message: {
              content:
                '{"classification":{"domain":"QUALITY","subtype":"PRODUCTION_PROCESS_ABNORMALITY","confidence":"HIGH","rationale":["x"],"missingInformation":[]},"tasks":[{"id":"task_1","title":"a","objective":"b","collaborators":[],"inputMaterials":["c"],"actions":["d"],"deliverables":["e"],"completionCriteria":["f"],"timeNode":{"checkpoints":["g"],"dueAt":"T+1"},"feedbackFrequency":"每日反馈","risksAndOpenQuestions":[],"dependencyTaskIds":[]}],"openQuestions":[]}',
            },
          },
        ],
        usage: {
          prompt_tokens: 100,
          completion_tokens: 50,
          total_tokens: 150,
        },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = new QwenCompatibleClient({
      baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
      apiKey: "test-key",
      model: "qwen-plus",
      timeoutMs: 10000,
      maxRetries: 0,
      temperature: 0.2,
      maxTokens: 2048,
    });
    const result = await client.generateStructuredPlan({
      background: "质量任务背景",
      domainHint: "QUALITY",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const requestBody = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(requestBody.messages[0].content).toContain("信息充分性");
    expect(requestBody.messages[0].content).toContain("gateSelfCheck");
    expect(requestBody.messages[0].content).toContain("不要编造");
    expect(result.trace.requestId).toBe("req_001");
    expect(result.trace.tokenUsage.totalTokens).toBe(150);
    expect(result.payload.tasks).toHaveLength(1);
  });

  it("retries on transient failure and succeeds", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({}),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          id: "req_retry",
          model: "qwen-plus",
          choices: [
            {
              finish_reason: "stop",
              message: {
                content:
                  '{"classification":{"domain":"RD","subtype":"SOLUTION_DEVELOPMENT","confidence":"MEDIUM","rationale":["x"],"missingInformation":[]},"tasks":[{"id":"task_1","title":"a","objective":"b","collaborators":[],"inputMaterials":["c"],"actions":["d"],"deliverables":["e"],"completionCriteria":["f"],"timeNode":{"checkpoints":["g"],"dueAt":"T+1"},"feedbackFrequency":"每日反馈","risksAndOpenQuestions":[],"dependencyTaskIds":[]}],"openQuestions":[]}',
              },
            },
          ],
          usage: {
            prompt_tokens: 100,
            completion_tokens: 60,
            total_tokens: 160,
          },
        }),
      });
    vi.stubGlobal("fetch", fetchMock);

    const client = new QwenCompatibleClient({
      baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
      apiKey: "test-key",
      model: "qwen-plus",
      timeoutMs: 10000,
      maxRetries: 1,
      temperature: 0.2,
      maxTokens: 2048,
    });

    const result = await client.generateStructuredPlan({
      background: "研发任务背景",
      domainHint: "RD",
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.trace.requestId).toBe("req_retry");
    expect(result.payload.classification.domain).toBe("RD");
  });
});
