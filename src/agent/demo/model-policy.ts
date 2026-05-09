export interface ModelPolicy {
  model: string;
  temperature: number;
  maxTokens: number;
  timeoutMs: number;
  maxRetries: number;
  requestBudgetTokens: number;
}

export const DEFAULT_MODEL_POLICY: ModelPolicy = {
  model: "qwen3-plus",
  temperature: 0.2,
  maxTokens: 4000,
  timeoutMs: 60000,
  maxRetries: 1,
  requestBudgetTokens: 16000,
};

export function normalizeModelPolicy(
  input: Partial<ModelPolicy> = {}
): ModelPolicy {
  const merged = { ...DEFAULT_MODEL_POLICY, ...withoutUndefined(input) };
  return {
    model: merged.model,
    temperature: clamp(merged.temperature, 0, 1),
    maxTokens: Math.round(clamp(merged.maxTokens, 128, 8000)),
    timeoutMs: Math.round(clamp(merged.timeoutMs, 5000, 120000)),
    maxRetries: Math.round(clamp(merged.maxRetries, 0, 3)),
    requestBudgetTokens:
      merged.requestBudgetTokens > 0
        ? Math.round(merged.requestBudgetTokens)
        : DEFAULT_MODEL_POLICY.requestBudgetTokens,
  };
}

function withoutUndefined(input: Partial<ModelPolicy>): Partial<ModelPolicy> {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined)
  ) as Partial<ModelPolicy>;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
