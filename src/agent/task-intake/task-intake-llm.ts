import { logStructured } from "../../infra/logger";

export interface TaskIntakePolicy {
  llmEnabled: boolean;
  llmModel: string;
  llmTimeoutMs: number;
  llmMaxTokens: number;
  llmBaseUrl: string;
  llmApiKey: string;
}

export type TaskIntakeLlmFn = (input: {
  system: string;
  user: string;
  policy: TaskIntakePolicy;
}) => Promise<string | null>;

let taskIntakeLlmForTest: TaskIntakeLlmFn | undefined;

export function __setTaskIntakeLlmForTest(fn: TaskIntakeLlmFn | undefined): void {
  taskIntakeLlmForTest = fn;
}

function env(name: string): string {
  return String(process.env[name] ?? "").trim();
}

function envFlag(name: string, defaultValue: boolean): boolean {
  const raw = env(name).toLowerCase();
  if (!raw) return defaultValue;
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

function envInt(name: string, defaultValue: number): number {
  const n = Number(env(name));
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : defaultValue;
}

export function loadTaskIntakePolicy(): TaskIntakePolicy {
  return {
    llmEnabled: envFlag("TASK_INTAKE_LLM_ENABLED", true),
    llmModel: env("TASK_INTAKE_LLM_MODEL") || "qwen3.6-flash",
    llmTimeoutMs: envInt("TASK_INTAKE_LLM_TIMEOUT_MS", 30_000),
    llmMaxTokens: envInt("TASK_INTAKE_LLM_MAX_TOKENS", 4000),
    llmBaseUrl: env("QWEN_BASE_URL") || "https://dashscope.aliyuncs.com/compatible-mode/v1",
    llmApiKey: env("DASHSCOPE_API_KEY") || env("QWEN_API_KEY"),
  };
}

async function callDefaultLlm(input: {
  system: string;
  user: string;
  policy: TaskIntakePolicy;
}): Promise<string | null> {
  if (!input.policy.llmEnabled || !input.policy.llmApiKey) return null;
  const response = await fetch(`${input.policy.llmBaseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${input.policy.llmApiKey}`,
    },
    body: JSON.stringify({
      model: input.policy.llmModel,
      temperature: 0,
      max_tokens: input.policy.llmMaxTokens,
      enable_thinking: false,
      messages: [
        { role: "system", content: input.system },
        { role: "user", content: input.user },
      ],
    }),
  });
  if (!response.ok) return null;
  const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const content = String(data.choices?.[0]?.message?.content ?? "").trim();
  return content || null;
}

export function extractJsonFromLlmContent(content: string): unknown | null {
  const match = content.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
}

export async function callTaskIntakeLlm(input: {
  system: string;
  user: string;
  policy: TaskIntakePolicy;
}): Promise<string | null> {
  const startedAt = Date.now();
  const llm = taskIntakeLlmForTest ?? callDefaultLlm;
  try {
    const result = await Promise.race([
      llm(input),
      new Promise<null>((resolve) => {
        setTimeout(() => resolve(null), input.policy.llmTimeoutMs);
      }),
    ]);
    logStructured({
      event: result ? "task_intake_llm_ok" : "task_intake_llm_empty",
      durationMs: Date.now() - startedAt,
    });
    return result;
  } catch (err) {
    logStructured({
      event: "task_intake_llm_error",
      durationMs: Date.now() - startedAt,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}
