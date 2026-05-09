import type { ToolDefinition, ToolHandler } from "../demo/qwen-compatible-client";

export const UPDATE_KNOWN_FACTS_TOOL: ToolDefinition = {
  type: "function",
  function: {
    name: "update_known_facts",
    description: "追加记录你从用户那里了解到的事实。facts 数组会被合并到现有已知事实列表中（去重）。用于在后续对话中避免重复追问已有答案的问题。每次了解到新信息时都应调用此工具。",
    parameters: {
      type: "object",
      properties: {
        facts: { type: "array", items: { type: "string" }, description: "新增的已知事实，每条一句话" },
      },
      required: ["facts"],
    },
  },
};

export const LIST_KNOWN_FACTS_TOOL: ToolDefinition = {
  type: "function",
  function: {
    name: "list_known_facts",
    description: "查看你已记录的全部已知事实。在追问之前应先调用此工具，确认是否已经从用户那里获得了相关信息，避免重复提问。",
    parameters: { type: "object", properties: {} },
  },
};

export interface KnownFactsStore {
  get(): string[];
  update(facts: string[]): void;
}

export function buildKnownFactsHandlers(store: KnownFactsStore): {
  get: ToolHandler;
  update: ToolHandler;
} {
  return {
    get: async () => {
      const facts = store.get();
      return { facts, count: facts.length, empty: facts.length === 0 };
    },
    update: async (args) => {
      const a = args as { facts?: string[] };
      if (!Array.isArray(a.facts)) throw new Error("facts must be a string array");
      store.update(a.facts);
      return { added: a.facts.length, total: store.get().length };
    },
  };
}
