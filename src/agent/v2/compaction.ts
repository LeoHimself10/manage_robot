import type { BaseMessage } from "@langchain/core/messages";
import { ChatOpenAI } from "@langchain/openai";
import type { QwenPlannerConfig } from "../demo/qwen-planner";

const DEFAULT_COMPACT_CHARS = 24_000;

function readCompactThreshold(): number {
  const raw = Number(process.env.V2_HISTORY_COMPACT_CHARS ?? String(DEFAULT_COMPACT_CHARS));
  return Number.isFinite(raw) && raw > 2000 ? Math.floor(raw) : DEFAULT_COMPACT_CHARS;
}

function messageChars(messages: BaseMessage[]): number {
  let total = 0;
  for (const m of messages) {
    const content = typeof m.content === "string" ? m.content : JSON.stringify(m.content);
    total += content.length;
  }
  return total;
}

// TODO(harness-conformance C4): the head/tail split below is by message count
// and may cut between an AIMessage(tool_calls) and its ToolMessage, or leave the
// tail starting with an orphan ToolMessage. Atomic-pair adjustment is deferred
// to next round per 2026-06-12 scope — do not change behavior here yet.
/** Summarize older turns when history exceeds threshold; keep recent tail verbatim. */
export async function maybeCompactHistory(input: {
  messages: BaseMessage[];
  model: ChatOpenAI;
  config: QwenPlannerConfig;
}): Promise<{ messages: BaseMessage[]; summary?: string }> {
  const threshold = readCompactThreshold();
  if (messageChars(input.messages) <= threshold) {
    return { messages: input.messages };
  }

  const keepTail = Math.max(4, Number(process.env.V2_HISTORY_COMPACT_KEEP_TURNS ?? "6"));
  const head = input.messages.slice(0, Math.max(0, input.messages.length - keepTail));
  const tail = input.messages.slice(-keepTail);
  if (head.length === 0) {
    return { messages: input.messages };
  }

  const transcript = head
    .map((m) => {
      const role = m.getType();
      const text = typeof m.content === "string" ? m.content : JSON.stringify(m.content);
      return `${role}: ${text.slice(0, 1500)}`;
    })
    .join("\n\n");

  try {
    const resp = await input.model.invoke([
      {
        role: "system",
        content:
          "你是会话摘要助手。用中文 400 字以内概括以下对话中的：用户目标、已确认约束、草案/指派进展、待办。不要编造。",
      },
      { role: "user", content: transcript },
    ]);
    const summary =
      typeof resp.content === "string"
        ? resp.content.trim()
        : String(resp.content ?? "").trim();
    if (!summary) {
      return { messages: input.messages };
    }
    return {
      messages: tail,
      summary,
    };
  } catch {
    return { messages: input.messages };
  }
}
