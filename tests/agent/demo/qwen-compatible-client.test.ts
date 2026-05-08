import { afterEach, describe, expect, it, vi } from "vitest";
import {
  QwenCompatibleClient,
  assembleSseTextForTest,
  parseAssistantJsonPayload,
  sleepWithJitter,
} from "../../../src/agent/demo/qwen-compatible-client";

const SAMPLE_QUALITY_JSON =
  '{"classification":{"domain":"QUALITY","subtype":"PRODUCTION_PROCESS_ABNORMALITY","confidence":"HIGH","rationale":["x"],"missingInformation":[]},"capaAdvisory":{"advisory":"UNCERTAIN","rationale":["x"],"disclaimer":"d","promptingQuestions":[]},"tasks":[{"id":"task_1","title":"a","objective":"b","collaborators":[],"inputMaterials":["c"],"actions":["d"],"deliverables":["e"],"completionCriteria":["f"],"timeNode":{"checkpoints":["g"],"dueAt":"T+1"},"feedbackFrequency":"每日反馈","risksAndOpenQuestions":[],"dependencyTaskIds":[]}],"openQuestions":[],"gateSelfCheck":{"passed":true,"missingByTask":[]}}';

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
    expect(requestBody.messages[0].content).toContain("v2.8");
    expect(result.trace.requestId).toBe("req_001");
    expect(result.trace.traceId).toBeUndefined();
    expect(result.trace.tokenUsage.totalTokens).toBe(150);
    expect(result.payload.tasks).toHaveLength(1);
  });

  it("propagates traceId into trace metadata", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        id: "req_tid",
        model: "qwen-plus",
        choices: [
          {
            finish_reason: "stop",
            message: {
              content:
                '{"classification":{"domain":"QUALITY","subtype":"PRODUCTION_PROCESS_ABNORMALITY","confidence":"HIGH","rationale":["x"],"missingInformation":[]},"capaAdvisory":{"advisory":"UNCERTAIN","rationale":["x"],"disclaimer":"d","promptingQuestions":[]},"tasks":[{"id":"task_1","title":"a","objective":"b","collaborators":[],"inputMaterials":["c"],"actions":["d"],"deliverables":["e"],"completionCriteria":["f"],"timeNode":{"checkpoints":["g"],"dueAt":"T+1"},"feedbackFrequency":"每日反馈","risksAndOpenQuestions":[],"dependencyTaskIds":[]}],"openQuestions":[]}',
            },
          },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
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
      background: "x",
      domainHint: "QUALITY",
      traceId: "trace-demo-1",
    });

    expect(result.trace.traceId).toBe("trace-demo-1");
    const userContent = JSON.parse(fetchMock.mock.calls[0][1].body as string)
      .messages[1].content as string;
    expect(userContent).toContain("trace-demo-1");
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

  it("does not retry when maxRetries is 0", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({}),
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

    await expect(
      client.generateStructuredPlan({ background: "x", domainHint: "RD" })
    ).rejects.toThrow();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("assembles SSE chunks into structured plan when stream=true", async () => {
    const chunk1Obj = {
      id: "req_sse",
      model: "qwen-plus",
      choices: [{ delta: { content: SAMPLE_QUALITY_JSON.slice(0, 70) } }],
    };
    const chunk2Obj = {
      choices: [{ delta: { content: SAMPLE_QUALITY_JSON.slice(70) } }],
      usage: {
        prompt_tokens: 10,
        completion_tokens: 20,
        total_tokens: 30,
      },
    };
    const sseText = `data: ${JSON.stringify(chunk1Obj)}\n\ndata: ${JSON.stringify(chunk2Obj)}\n\ndata: [DONE]\n`;
    expect(assembleSseTextForTest(sseText).content).toBe(SAMPLE_QUALITY_JSON);

    const sseStream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(sseText));
        controller.close();
      },
    });

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      body: sseStream,
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
      stream: true,
    });

    const result = await client.generateStructuredPlan({
      background: "x",
      domainHint: "QUALITY",
    });

    const parsedBody = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(parsedBody.stream).toBe(true);
    expect(parsedBody.stream_options).toEqual({ include_usage: true });

    expect(result.trace.requestId).toBe("req_sse");
    expect(result.trace.tokenUsage.totalTokens).toBe(30);
    expect(result.payload.tasks).toHaveLength(1);
  });

  it("calls streamHooks.onAssistantDelta while SSE chunks arrive", async () => {
    const chunk1Obj = {
      id: "req_sse_hook",
      model: "qwen-plus",
      choices: [{ delta: { content: SAMPLE_QUALITY_JSON.slice(0, 70) } }],
    };
    const chunk2Obj = {
      choices: [{ delta: { content: SAMPLE_QUALITY_JSON.slice(70) } }],
      usage: {
        prompt_tokens: 10,
        completion_tokens: 20,
        total_tokens: 30,
      },
    };
    const sseText = `data: ${JSON.stringify(chunk1Obj)}\n\ndata: ${JSON.stringify(chunk2Obj)}\n\ndata: [DONE]\n`;
    const sseStream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(sseText));
        controller.close();
      },
    });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      body: sseStream,
    });
    vi.stubGlobal("fetch", fetchMock);

    const deltas: string[] = [];
    const client = new QwenCompatibleClient({
      baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
      apiKey: "test-key",
      model: "qwen-plus",
      timeoutMs: 10000,
      maxRetries: 0,
      temperature: 0.2,
      maxTokens: 2048,
      stream: true,
      streamHooks: { onAssistantDelta: (s) => deltas.push(s) },
    });

    await client.generateStructuredPlan({
      background: "x",
      domainHint: "QUALITY",
    });

    expect(deltas.length).toBeGreaterThan(0);
    expect(deltas[deltas.length - 1]).toBe(SAMPLE_QUALITY_JSON);
  });
});

describe("sleepWithJitter", () => {
  it("resolves after a bounded delay (used between HTTP retries)", async () => {
    vi.useFakeTimers();
    const p = sleepWithJitter(0, 1000, 10_000);
    await vi.advanceTimersByTimeAsync(3000);
    await p;
    vi.useRealTimers();
  });
});
