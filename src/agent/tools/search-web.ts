import type { ToolDefinition, ToolHandler } from "../demo/qwen-compatible-client";

export const SEARCH_WEB_TOOL: ToolDefinition = {
  type: "function",
  function: {
    name: "search_web",
    description:
      "搜索技术方案、类似案例、解决思路。query 必须是自然语言短句（如你输入搜索框的一句话），不要堆砌关键词或枚举近义词。",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "自然语言搜索短句，如 'OCT主机USB掉线排查方法' 或 '医疗器械USB数据传输稳定性方案'。",
        },
      },
      required: ["query"],
    },
  },
};

export function buildSearchWebHandler(): ToolHandler {
  return async (args) => {
    const a = args as { query?: string };
    const q = (a.query ?? "").trim();
    if (!q) return { results: [], note: "空查询" };

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
