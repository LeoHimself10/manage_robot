import type { ToolDefinition, ToolHandler } from "../demo/qwen-compatible-client";
import { generateQueryEmbedding, searchWithEmbedding } from "../../infra/plan-index";

export const SEARCH_SIMILAR_PLANS_TOOL: ToolDefinition = {
  type: "function",
  function: {
    name: "search_similar_plans",
    description: "搜索历史类似任务以供参考。输入查询文本，返回最相近的历史任务摘要（top 3）。",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "搜索查询文本" },
      },
      required: ["query"],
    },
  },
};

export function buildSearchSimilarPlansHandler(): ToolHandler {
  return async (args) => {
    const a = args as { query?: string };
    const q = (a.query ?? "").trim();
    if (!q) {
      return {
        results: [],
        query: q,
        hint: "empty_query_provide_keywords_first",
      };
    }

    const embedding = await generateQueryEmbedding(q);
    if (!embedding) {
      return {
        results: [],
        query: q,
        hint: "embedding_api_unavailable_do_not_retry_same_query",
      };
    }

    const results = searchWithEmbedding(embedding, 3);
    if (results.length === 0) {
      return {
        results,
        query: q,
        hint: "no_match_in_plan_index_do_not_retry_same_query",
      };
    }
    return { results, query: q };
  };
}
