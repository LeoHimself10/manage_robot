import type { ToolDefinition, ToolHandler } from "../demo/qwen-compatible-client";

const MAX_QUERY_LENGTH = 200;

export const SEARCH_WEB_TOOL: ToolDefinition = {
  type: "function",
  function: {
    name: "search_web",
    description: "搜索技术方案、类似案例、解决思路。输入简短中文查询（一句话，不超过200字），返回搜索结果摘要。",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", maxLength: MAX_QUERY_LENGTH, description: "简短中文查询，如 'OCT 主机 USB 掉线 排查方法'" },
      },
      required: ["query"],
    },
  },
};

export function buildSearchWebHandler(): ToolHandler {
  return async (args) => {
    const a = args as { query?: string };
    let q = (a.query ?? "").trim();
    if (!q) return { results: [], note: "空查询" };

    // 安全截断：防止模型生成超长 query
    if (q.length > MAX_QUERY_LENGTH) {
      q = q.slice(0, MAX_QUERY_LENGTH);
    }

    const apiKey = process.env.DASHSCOPE_API_KEY || process.env.QWEN_API_KEY;
    if (!apiKey) {
      return { results: [], note: "搜索 API 未配置（缺少 QWEN_API_KEY）", query: q };
    }
    try {
      const resp = await fetch("https://dashscope.aliyuncs.com/api/v1/services/aigc/text-generation/generation", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: "qwen-max",
          input: { messages: [{ role: "user", content: `搜索以下主题并给出中文摘要：${q}` }] },
          parameters: { enable_search: true, result_format: "message" },
        }),
      });
      const data = await resp.json() as Record<string, unknown>;
      if (!resp.ok) return { results: [], note: `搜索 API 错误: ${resp.status}`, query: q };
      const output = (data as Record<string, unknown>)?.output as Record<string, unknown> | undefined;
      const text = output?.text ?? JSON.stringify(data).slice(0, 1000);
      return { results: [{ text }], query: q };
    } catch (err) {
      return { results: [], note: `搜索失败: ${err instanceof Error ? err.message : String(err)}`, query: q };
    }
  };
}
