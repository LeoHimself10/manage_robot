import { END, START, StateGraph } from "@langchain/langgraph";
import {
  routeAfterAgent,
  routeAfterTools,
  v2AgentNode,
  v2CompactNode,
  v2ToolsNode,
} from "./graph-nodes";
import { V2AgentState } from "./state";

function buildV2AgentStateGraph() {
  return new StateGraph(V2AgentState)
    .addNode("compact", v2CompactNode)
    .addNode("agent", v2AgentNode)
    .addNode("tools", v2ToolsNode)
    .addEdge(START, "compact")
    .addEdge("compact", "agent")
    .addConditionalEdges("agent", routeAfterAgent, {
      tools: "tools",
      [END]: END,
    })
    .addConditionalEdges("tools", routeAfterTools, {
      agent: "agent",
      [END]: END,
    });
}

let compiledGraph: ReturnType<ReturnType<typeof buildV2AgentStateGraph>["compile"]> | undefined;

/** Compiled once; no checkpointer — PlanSession remains cross-turn authority. */
export function getV2CompiledAgentGraph() {
  if (!compiledGraph) {
    compiledGraph = buildV2AgentStateGraph().compile({
      name: "manage_robot_v2_agent",
    });
  }
  return compiledGraph;
}

/** @internal Test hook to assert graph topology. */
export function buildV2AgentStateGraphForTest() {
  return buildV2AgentStateGraph();
}
