import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { AIMessage, ToolMessage } from "@langchain/core/messages";
import type { PlanSession } from "../../../src/infra/plan-session-store";
import { runV2AgentTurn } from "../../../src/agent/v2/graph";
import { v2ToolsNode } from "../../../src/agent/v2/graph-nodes";
import { V2_GRAPH_RUNTIME_CONFIG_KEY } from "../../../src/agent/v2/graph-runtime";
import { buildV2AgentStateGraphForTest } from "../../../src/agent/v2/graph-build";
import { V2_GRAPH_NODE_NAMES, type V2AgentStateType } from "../../../src/agent/v2/state";

describe("runV2AgentTurn routing", () => {
  beforeEach(() => {
    vi.stubEnv("AGENT_MAX_TOOL_CALLS", "4");
    vi.stubEnv("DINGTALK_ORCHESTRATOR_MAX_ITERATIONS", "3");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("ends turn when model returns no tool_calls", async () => {
    const session: PlanSession = {
      chatKeyHash: "h",
      planId: "p1",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      conversationHistory: [],
      knownFacts: [],
    };

    const model = {
      bindTools: () => ({
        invoke: vi.fn().mockResolvedValue(new AIMessage({ content: "好的，已收到。" })),
      }),
    };

    const result = await runV2AgentTurn({
      userMessage: "你好",
      session,
      model: model as never,
      clientConfig: {
        apiKey: "k",
        baseUrl: "https://example.com",
        model: "qwen-test",
        timeoutMs: 1000,
        maxTokens: 1000,
        maxRetries: 0,
        temperature: 0,
      },
      employeeRepo: { list: () => [] },
      toolProfile: "planner",
    });

    expect(result.finalMessage).toContain("好的");
    expect(result.toolCallsTotal).toBe(0);
    expect(result.toolInvocationNames).toEqual([]);
  });
});

describe("v2ToolsNode handler fault tolerance (FR-4/C1)", () => {
  it("a throwing handler yields a structured ToolMessage and does not reject the turn", async () => {
    const boomDef = {
      type: "function" as const,
      function: {
        name: "boom",
        description: "always throws",
        parameters: { type: "object", properties: {} },
      },
    };
    const runtime = {
      traceId: "t1",
      startedAtMs: Date.now(),
      maxTotalMs: 60_000,
      maxToolCalls: 16,
      registry: {
        boom: {
          definition: boomDef,
          handler: () => {
            throw new Error("kaboom");
          },
        },
      },
    };

    const state = {
      messages: [
        new AIMessage({
          content: "",
          tool_calls: [{ name: "boom", id: "call-1", args: {} }],
        }),
      ],
      toolInvocationNames: [],
      loopIteration: 1,
      toolsMsTotal: 0,
      pendingAgentLlmMs: 0,
      shouldStop: false,
    } as unknown as V2AgentStateType;

    const result = await v2ToolsNode(state, {
      configurable: { [V2_GRAPH_RUNTIME_CONFIG_KEY]: runtime },
    } as never);

    const msg = (result.messages as ToolMessage[])[0];
    expect(msg).toBeInstanceOf(ToolMessage);
    const parsed = JSON.parse(String(msg.content));
    expect(parsed.ok).toBe(false);
    expect(parsed.error).toBe("tool_execution_failed");
    expect(parsed.toolName).toBe("boom");
    expect(result.toolInvocationNames).toEqual(["boom"]);
  });
});

describe("v2 StateGraph topology", () => {
  it("wires compact → agent ↔ tools", () => {
    const builder = buildV2AgentStateGraphForTest();
    expect(V2_GRAPH_NODE_NAMES).toEqual(["compact", "agent", "tools"]);
    expect(builder.nodes).toHaveProperty("compact");
    expect(builder.nodes).toHaveProperty("agent");
    expect(builder.nodes).toHaveProperty("tools");
  });
});
