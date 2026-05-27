export interface WeeklyDashboardPolicy {
  timezone: string;
  defaultSpan: number;
  maxSpan: number;
  feedPageSize: number;
  feedMaxPageSize: number;
  advisorLlmEnabled: boolean;
  advisorLlmModel: string;
  advisorLlmTimeoutMs: number;
  advisorLlmMaxTokens: number;
  advisorLlmBaseUrl: string;
  advisorLlmApiKey: string;
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

export function loadWeeklyDashboardPolicy(): WeeklyDashboardPolicy {
  return {
    timezone: env("WEEKLY_DASHBOARD_TIMEZONE") || env("FOLLOWUP_TIMEZONE") || "Asia/Shanghai",
    defaultSpan: 1,
    maxSpan: envInt("WEEKLY_DASHBOARD_SPAN_MAX", 6),
    feedPageSize: envInt("WEEKLY_DASHBOARD_FEED_PAGE_SIZE", 50),
    feedMaxPageSize: envInt("WEEKLY_DASHBOARD_FEED_MAX_PAGE_SIZE", 100),
    advisorLlmEnabled: envFlag("WEEKLY_ADVISOR_LLM_ENABLED", true),
    advisorLlmModel: env("WEEKLY_ADVISOR_LLM_MODEL") || "qwen3.6-flash",
    advisorLlmTimeoutMs: envInt("WEEKLY_ADVISOR_LLM_TIMEOUT_MS", 8000),
    advisorLlmMaxTokens: envInt("WEEKLY_ADVISOR_LLM_MAX_TOKENS", 900),
    advisorLlmBaseUrl: env("QWEN_BASE_URL") || "https://dashscope.aliyuncs.com/compatible-mode/v1",
    advisorLlmApiKey: env("DASHSCOPE_API_KEY") || env("QWEN_API_KEY"),
  };
}

export function clampWeeklyDashboardSpan(raw: unknown, policy: WeeklyDashboardPolicy): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return policy.defaultSpan;
  return Math.max(0, Math.min(Math.floor(n), policy.maxSpan));
}

export function clampWeeklyFeedLimit(raw: unknown, policy: WeeklyDashboardPolicy): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return policy.feedPageSize;
  return Math.max(1, Math.min(Math.floor(n), policy.feedMaxPageSize));
}
