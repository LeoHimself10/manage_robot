import { ChatOpenAI } from "@langchain/openai";
import type { QwenPlannerConfig } from "../demo/qwen-planner";

function readEnvBool(name: string, fallback: boolean): boolean {
  const v = process.env[name]?.trim().toLowerCase();
  if (!v) return fallback;
  if (v === "1" || v === "true" || v === "yes") return true;
  if (v === "0" || v === "false" || v === "no") return false;
  return fallback;
}

/** Whether Qwen thinking mode is enabled (forced tool_choice is unsupported then). */
export function readV2ThinkingEnabled(): boolean {
  return readEnvBool("DINGTALK_QWEN_THINKING", false);
}

/** DashScope OpenAI-compatible chat model for v2 LangGraph agent. */
export function buildV2ChatModel(config: QwenPlannerConfig): ChatOpenAI {
  const thinking = readV2ThinkingEnabled();
  return new ChatOpenAI({
    model: config.model,
    temperature: config.temperature,
    maxTokens: config.maxTokens,
    timeout: config.timeoutMs,
    maxRetries: config.maxRetries,
    apiKey: config.apiKey,
    configuration: {
      baseURL: config.baseUrl.replace(/\/$/, ""),
    },
    modelKwargs: {
      enable_thinking: thinking,
      extra_body: { enable_thinking: thinking },
    },
  });
}
