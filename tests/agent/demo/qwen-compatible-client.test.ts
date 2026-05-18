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
    expect(requestBody).not.toHaveProperty("response_format");
    // legacy demo path — prompt is now a stub
    expect(requestBody.messages[0].content).toContain("legacy-demo-planner");
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
    const requestBody = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    // legacy path: user message is just request.background
    expect(requestBody.messages[1].content).toBe("x");
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
    expect(parsedBody).not.toHaveProperty("response_format");
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

describe("callWithTools", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("executes a single tool call then returns forced JSON", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          id: "req_tc1",
          model: "qwen-plus",
          choices: [
            {
              finish_reason: "tool_calls",
              message: {
                content: null,
                tool_calls: [
                  {
                    id: "call_1",
                    type: "function",
                    function: {
                      name: "search_employees",
                      arguments: '{"skills":["8D"]}',
                    },
                  },
                ],
              },
            },
          ],
          usage: { prompt_tokens: 50, completion_tokens: 10, total_tokens: 60 },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          id: "req_tc2",
          model: "qwen-plus",
          choices: [
            {
              finish_reason: "stop",
              message: { content: '{"ok":true,"employees":[]}' },
            },
          ],
          usage: { prompt_tokens: 60, completion_tokens: 20, total_tokens: 80 },
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

    const searchHandler = vi.fn().mockResolvedValue([{ name: "John" }]);

    const result = await client.callWithTools({
      messages: [
        { role: "system", content: "You are a helpful assistant." },
        { role: "user", content: "Search for 8D employees" },
      ],
      tools: [
        {
          type: "function",
          function: {
            name: "search_employees",
            description: "Search employees by skills",
            parameters: {
              type: "object",
              properties: {
                skills: {
                  type: "array",
                  items: { type: "string" },
                },
              },
            },
          },
        },
      ],
      toolHandlers: { search_employees: searchHandler },
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(searchHandler).toHaveBeenCalledWith({ skills: ["8D"] });
    expect(result.toolCallsExecuted).toBe(1);
    expect((result.payload as Record<string, unknown>).ok).toBe(true);
    expect(result.trace.tokenUsage.totalTokens).toBe(140);
    expect(result.rawContent).toBe('{"ok":true,"employees":[]}');
  });

  it("returns JSON directly when no tool_calls are returned", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        id: "req_no_tc",
        model: "qwen-plus",
        choices: [
          {
            finish_reason: "stop",
            message: { content: '{"result":"direct"}' },
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
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

    const result = await client.callWithTools({
      messages: [
        { role: "system", content: "You are a helpful assistant." },
        { role: "user", content: "Do something" },
      ],
      tools: [
        {
          type: "function",
          function: { name: "test_tool", description: "Test", parameters: {} },
        },
      ],
      toolHandlers: { test_tool: async () => ({}) },
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.toolCallsExecuted).toBe(0);
    expect((result.payload as Record<string, unknown>).result).toBe("direct");
  });

  it("throws when both iterations return tool_calls", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          choices: [
            {
              message: {
                content: null,
                tool_calls: [
                  {
                    id: "call_a",
                    type: "function",
                    function: { name: "search_employees", arguments: "{}" },
                  },
                ],
              },
            },
          ],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          choices: [
            {
              message: {
                content: null,
                tool_calls: [
                  {
                    id: "call_b",
                    type: "function",
                    function: { name: "other_tool", arguments: "{}" },
                  },
                ],
              },
            },
          ],
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

    await expect(
      client.callWithTools({
        messages: [{ role: "user", content: "hi" }],
        tools: [
          {
            type: "function",
            function: { name: "search_employees", description: "x", parameters: {} },
          },
        ],
        toolHandlers: { search_employees: async () => ({}) },
      })
    ).rejects.toThrow(/No handler for tool: other_tool/);
  });

  it("throws when tool handler is not found", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [
          {
            message: {
              content: null,
              tool_calls: [
                {
                  id: "call_1",
                  type: "function",
                  function: { name: "nonexistent_tool", arguments: "{}" },
                },
              ],
            },
          },
        ],
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

    await expect(
      client.callWithTools({
        messages: [{ role: "user", content: "hi" }],
        tools: [
          {
            type: "function",
            function: { name: "some_tool", description: "x", parameters: {} },
          },
        ],
        toolHandlers: { some_tool: async () => ({}) },
      })
    ).rejects.toThrow(/No handler for tool/);
  });

  it("throws when tool_call arguments contain invalid JSON", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [
          {
            message: {
              content: null,
              tool_calls: [
                {
                  id: "call_1",
                  type: "function",
                  function: { name: "some_tool", arguments: "not-json" },
                },
              ],
            },
          },
        ],
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

    await expect(
      client.callWithTools({
        messages: [{ role: "user", content: "hi" }],
        tools: [
          {
            type: "function",
            function: { name: "some_tool", description: "x", parameters: {} },
          },
        ],
        toolHandlers: { some_tool: async () => ({}) },
      })
    ).rejects.toThrow(/Invalid JSON in tool_call arguments/);
  });

  it("supports multi-round tool calling in v3.0", async () => {
    let callCount = 0;
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => {
        callCount += 1;
        if (callCount === 1)
          return {
            choices: [
              {
                message: {
                  tool_calls: [
                    {
                      id: "c1",
                      type: "function",
                      function: {
                        name: "search_employees",
                        arguments: '{"domain":"QUALITY"}',
                      },
                    },
                  ],
                },
              },
            ],
            usage: { total_tokens: 50 },
          };
        if (callCount === 2)
          return {
            choices: [
              {
                message: {
                  tool_calls: [
                    {
                      id: "c2",
                      type: "function",
                      function: {
                        name: "search_web",
                        arguments: '{"query":"test"}',
                      },
                    },
                  ],
                },
              },
            ],
            usage: { total_tokens: 50 },
          };
        return {
          choices: [{ message: { content: '{"ok":true}' } }],
          usage: { total_tokens: 50 },
        };
      },
    }));
    vi.stubGlobal("fetch", fetchMock);

    const client = new QwenCompatibleClient({
      baseUrl: "https://test",
      apiKey: "k",
      model: "qwen",
      timeoutMs: 10000,
      maxRetries: 0,
      temperature: 0,
      maxTokens: 2000,
    });

    const result = await client.callWithTools({
      messages: [{ role: "user", content: "test" }],
      tools: [
        {
          type: "function",
          function: {
            name: "search_employees",
            description: "search employees",
            parameters: {
              type: "object",
              properties: { domain: { type: "string" } },
            },
          },
        },
        {
          type: "function",
          function: {
            name: "search_web",
            description: "search web",
            parameters: {
              type: "object",
              properties: { query: { type: "string" } },
            },
          },
        },
      ],
      toolHandlers: {
        search_employees: async () => ({ candidates: [], total: 0 }),
        search_web: async () => ({ results: [] }),
      },
      maxIterations: 6,
    });

    expect(result.toolCallsExecuted).toBe(2);
    expect(result.payload).toEqual({ ok: true });
    expect(callCount).toBe(3); // 2 tool_call rounds + 1 final
  });

  it("tracks parseMs separately from tool execution time", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          choices: [
            {
              message: {
                tool_calls: [
                  {
                    id: "slow_call",
                    type: "function",
                    function: { name: "search_employees", arguments: "{}" },
                  },
                ],
              },
            },
          ],
          usage: { total_tokens: 20 },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{ message: { content: '{"ok":true}' } }],
          usage: { total_tokens: 20 },
        }),
      });
    vi.stubGlobal("fetch", fetchMock);
    const client = new QwenCompatibleClient({
      baseUrl: "https://test",
      apiKey: "k",
      model: "qwen",
      timeoutMs: 10000,
      maxRetries: 0,
      temperature: 0,
      maxTokens: 2000,
    });
    const result = await client.callWithTools({
      messages: [{ role: "user", content: "test" }],
      tools: [
        {
          type: "function",
          function: { name: "search_employees", description: "x", parameters: {} },
        },
      ],
      toolHandlers: {
        search_employees: async () => {
          await new Promise((resolve) => setTimeout(resolve, 25));
          return { candidates: [] };
        },
      },
      maxIterations: 2,
    });
    expect(result.timing?.iterations[0].toolsMs).toBeGreaterThanOrEqual(20);
    expect(result.timing?.iterations[0].parseMs).toBeLessThan(result.timing?.iterations[0].toolsMs ?? 0);
  });

  it("stops when total token budget is exceeded", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          choices: [
            {
              message: {
                tool_calls: [
                  {
                    id: "c1",
                    type: "function",
                    function: { name: "search_employees", arguments: "{}" },
                  },
                ],
              },
            },
          ],
          usage: { total_tokens: 200, prompt_tokens: 100, completion_tokens: 100 },
        }),
      });
    vi.stubGlobal("fetch", fetchMock);
    const client = new QwenCompatibleClient({
      baseUrl: "https://test",
      apiKey: "k",
      model: "qwen",
      timeoutMs: 10000,
      maxRetries: 0,
      temperature: 0,
      maxTokens: 2000,
    });
    await expect(
      client.callWithTools({
        messages: [{ role: "user", content: "test" }],
        tools: [
          {
            type: "function",
            function: { name: "search_employees", description: "x", parameters: {} },
          },
        ],
        toolHandlers: { search_employees: async () => ({}) },
        maxTotalTokens: 120,
      }),
    ).rejects.toThrow(/token budget/);
  });

  it("uses max(prompt) + sum(completion) token budget for multi-round guard", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          choices: [
            {
              message: {
                tool_calls: [
                  {
                    id: "c1",
                    type: "function",
                    function: { name: "search_employees", arguments: "{}" },
                  },
                ],
              },
            },
          ],
          usage: { prompt_tokens: 3000, completion_tokens: 3000, total_tokens: 6000 },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          choices: [
            {
              message: {
                tool_calls: [
                  {
                    id: "c2",
                    type: "function",
                    function: { name: "search_employees", arguments: "{}" },
                  },
                ],
              },
            },
          ],
          usage: { prompt_tokens: 3000, completion_tokens: 3000, total_tokens: 6000 },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{ message: { content: '{"ok":true}' } }],
          usage: { prompt_tokens: 3000, completion_tokens: 1000, total_tokens: 4000 },
        }),
      });
    vi.stubGlobal("fetch", fetchMock);

    const client = new QwenCompatibleClient({
      baseUrl: "https://test",
      apiKey: "k",
      model: "qwen",
      timeoutMs: 10000,
      maxRetries: 0,
      temperature: 0,
      maxTokens: 2000,
    });

    const result = await client.callWithTools({
      messages: [{ role: "user", content: "test" }],
      tools: [
        {
          type: "function",
          function: { name: "search_employees", description: "x", parameters: {} },
        },
      ],
      toolHandlers: { search_employees: async () => ({ ok: true }) },
      maxTotalTokens: 10000,
    });

    expect(result.toolCallsExecuted).toBe(2);
    expect(result.payload).toEqual({ ok: true });
  });

  it("supports tool calling over SSE streaming when config.stream is true", async () => {
    /**
     * Regression guard for the DingTalk timeout fix: under stream=true the ReAct loop must
     * reassemble OpenAI-compatible streamed tool_calls (delta.tool_calls with index +
     * incrementally streamed function.arguments) into a complete tool_call before invoking
     * the local handler and then accept the final SSE answer chunk.
     */
    const toolCallSseChunks = [
      JSON.stringify({
        id: "req_stream_tc",
        model: "qwen-plus",
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: "call_stream_1",
                  type: "function",
                  function: { name: "search_employees", arguments: '{"skil' },
                },
              ],
            },
          },
        ],
      }),
      JSON.stringify({
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  function: { arguments: 'ls":["8D"]}' },
                },
              ],
            },
            finish_reason: "tool_calls",
          },
        ],
        usage: { prompt_tokens: 50, completion_tokens: 10, total_tokens: 60 },
      }),
    ];
    const toolCallSseText =
      toolCallSseChunks.map((c) => `data: ${c}`).join("\n\n") + "\n\ndata: [DONE]\n";

    const finalSseChunks = [
      JSON.stringify({
        id: "req_stream_final",
        model: "qwen-plus",
        choices: [
          { delta: { content: '{"ok":true,"employees":[]}' }, finish_reason: "stop" },
        ],
        usage: { prompt_tokens: 60, completion_tokens: 20, total_tokens: 80 },
      }),
    ];
    const finalSseText =
      finalSseChunks.map((c) => `data: ${c}`).join("\n\n") + "\n\ndata: [DONE]\n";

    const makeStream = (text: string) =>
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(text));
          controller.close();
        },
      });

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, status: 200, body: makeStream(toolCallSseText) })
      .mockResolvedValueOnce({ ok: true, status: 200, body: makeStream(finalSseText) });
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

    const searchHandler = vi.fn().mockResolvedValue([{ name: "Alice" }]);
    const result = await client.callWithTools({
      messages: [
        { role: "system", content: "you are helpful" },
        { role: "user", content: "find 8D experts" },
      ],
      tools: [
        {
          type: "function",
          function: {
            name: "search_employees",
            description: "search by skills",
            parameters: {
              type: "object",
              properties: { skills: { type: "array", items: { type: "string" } } },
            },
          },
        },
      ],
      toolHandlers: { search_employees: searchHandler },
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const firstBody = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(firstBody.stream).toBe(true);
    expect(firstBody.stream_options).toEqual({ include_usage: true });
    expect(searchHandler).toHaveBeenCalledWith({ skills: ["8D"] });
    expect(result.toolCallsExecuted).toBe(1);
    expect((result.payload as Record<string, unknown>).ok).toBe(true);
    expect(result.rawContent).toBe('{"ok":true,"employees":[]}');
  });
});
