export interface MeetingImportPolicy {
  llmEnabled: boolean;
  llmModel: string;
  llmTimeoutMs: number;
  llmMaxTokens: number;
  llmBaseUrl: string;
  llmApiKey: string;
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

export function loadMeetingImportPolicy(): MeetingImportPolicy {
  return {
    llmEnabled: envFlag("MEETING_IMPORT_LLM_ENABLED", true),
    llmModel: env("MEETING_IMPORT_LLM_MODEL") || "qwen3.6-flash",
    llmTimeoutMs: envInt("MEETING_IMPORT_LLM_TIMEOUT_MS", 30_000),
    llmMaxTokens: envInt("MEETING_IMPORT_LLM_MAX_TOKENS", 4000),
    llmBaseUrl: env("QWEN_BASE_URL") || "https://dashscope.aliyuncs.com/compatible-mode/v1",
    llmApiKey: env("DASHSCOPE_API_KEY") || env("QWEN_API_KEY"),
  };
}
