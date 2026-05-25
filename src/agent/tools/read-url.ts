import type { ToolDefinition, ToolHandler } from "../demo/qwen-compatible-client";
import { fetchUrlContent } from "../../integrations/url-fetch/fetch-url-content";

export const READ_URL_TOOL: ToolDefinition = {
  type: "function",
  function: {
    name: "read_url",
    description:
      "读取用户提供的公网 http(s) 链接页面正文，作为任务规划背景或与同条用户文字合并理解。用户消息含 http(s) URL 时调用（含「仅提供背景/先不拆任务」）；禁止用 search_web 代替。钉钉文档/需登录页可能失败，按 hint 引导用户粘贴正文。",
    parameters: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "完整的 http(s) URL。",
        },
      },
      required: ["url"],
    },
  },
};

export function readUrlEnabled(): boolean {
  return String(process.env.READ_URL_ENABLED ?? "1").trim() !== "0";
}

export function readUrlPerOrchestratorMax(): number {
  const raw = Number(String(process.env.READ_URL_PER_ORCHESTRATOR_MAX ?? "2").trim());
  return Number.isFinite(raw) && raw >= 1 ? Math.floor(raw) : 2;
}

export function buildReadUrlHandler(deps?: {
  onQuotaExhausted?: () => void;
  getCallCount?: () => number;
  incrementCallCount?: () => void;
}): ToolHandler {
  return async (args) => {
    const url = String((args as { url?: unknown }).url ?? "").trim();
    if (!url) {
      return { ok: false, reason: "empty_url", hint: "请提供完整的 http(s) 链接。" };
    }

    const maxCalls = readUrlPerOrchestratorMax();
    const current = deps?.getCallCount?.() ?? 0;
    if (current >= maxCalls) {
      deps?.onQuotaExhausted?.();
      return {
        ok: false,
        reason: "read_url_quota_exhausted",
        hint: `单轮最多读取 ${maxCalls} 个链接，请合并需求或粘贴关键段落。`,
        url,
      };
    }
    deps?.incrementCallCount?.();

    const result = await fetchUrlContent({ url });
    if (!result.ok) {
      return {
        ok: false,
        reason: result.reason,
        hint: result.hint,
        url: result.url,
        httpStatus: result.httpStatus,
      };
    }

    return {
      ok: true,
      url: result.url,
      finalUrl: result.finalUrl,
      title: result.title,
      text: result.text,
      chars: result.chars,
      truncated: result.truncated,
      note: result.note,
    };
  };
}
