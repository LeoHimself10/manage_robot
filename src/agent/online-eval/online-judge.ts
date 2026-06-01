import {
  buildOnlineJudgeSystemPrompt,
  ONLINE_JUDGE_PROMPT_VERSION,
} from "./online-judge-prompt";
import type { RedactedTurnContext } from "./recent-context";

export interface OnlineJudgeInput {
  userMessage: string;
  assistantReply: string;
  recentContext?: RedactedTurnContext[];
  metadata: Record<string, unknown>;
  modelConfig: {
    apiKey: string;
    baseUrl: string;
    timeoutMs: number;
  };
}

export interface OnlineJudgeResult {
  skipped: boolean;
  overallPass: boolean;
  scores: Record<string, number>;
  reasons: string[];
  promptVersion: string;
  error?: string;
}

function readJudgeEnabled(): boolean {
  return process.env.ONLINE_JUDGE_ENABLED !== "0";
}

function readJudgeModel(): string {
  return String(process.env.ONLINE_JUDGE_MODEL ?? "qwen-doc-turbo").trim();
}

function readJudgeTimeoutMs(fallback: number): number {
  const raw = Number(process.env.ONLINE_JUDGE_TIMEOUT_MS ?? "8000");
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
}

function parseJudgeJson(raw: string): {
  scores?: Record<string, unknown>;
  overallPass?: boolean;
  reasons?: unknown[];
} {
  const normalized = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim() ?? raw.trim();
  return JSON.parse(normalized) as {
    scores?: Record<string, unknown>;
    overallPass?: boolean;
    reasons?: unknown[];
  };
}

function normalizeScores(input: Record<string, unknown> | undefined): Record<string, number> {
  const keys = ["relevance", "guidance", "grounding", "actionability"] as const;
  const out: Record<string, number> = {};
  for (const key of keys) {
    const n = Number(input?.[key]);
    out[key] = Number.isFinite(n) ? Math.max(1, Math.min(5, n)) : 3;
  }
  return out;
}

export function shouldRunOnlineJudge(sampled: boolean): boolean {
  if (!readJudgeEnabled()) return false;
  return sampled;
}

export async function runOnlineJudge(input: OnlineJudgeInput): Promise<OnlineJudgeResult> {
  const promptVersion = ONLINE_JUDGE_PROMPT_VERSION;
  if (!readJudgeEnabled()) {
    return { skipped: true, overallPass: true, scores: {}, reasons: [], promptVersion };
  }

  const model = readJudgeModel();
  const timeoutMs = readJudgeTimeoutMs(input.modelConfig.timeoutMs);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(`${input.modelConfig.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${input.modelConfig.apiKey}`,
      },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        temperature: 0,
        max_tokens: Number(process.env.ONLINE_JUDGE_MAX_TOKENS ?? "600"),
        messages: [
          { role: "system", content: buildOnlineJudgeSystemPrompt() },
          {
            role: "user",
            content: JSON.stringify({
              promptVersion,
              recentContext: input.recentContext ?? [],
              userMessage: input.userMessage,
              assistantReply: input.assistantReply,
              metadata: input.metadata,
            }),
          },
        ],
      }),
    });
    if (!resp.ok) {
      return {
        skipped: true,
        overallPass: true,
        scores: {},
        reasons: [],
        promptVersion,
        error: `http_${resp.status}`,
      };
    }
    const json = (await resp.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const raw = String(json.choices?.[0]?.message?.content ?? "").trim();
    if (!raw) {
      return {
        skipped: true,
        overallPass: true,
        scores: {},
        reasons: [],
        promptVersion,
        error: "empty_response",
      };
    }
    const parsed = parseJudgeJson(raw);
    const scores = normalizeScores(parsed.scores);
    const reasons = (parsed.reasons ?? [])
      .map((r) => String(r).trim())
      .filter(Boolean)
      .slice(0, 5);
    const minScore = Math.min(...Object.values(scores));
    const overallPass =
      parsed.overallPass === true
      || (parsed.overallPass !== false && minScore >= 3);
    return { skipped: false, overallPass, scores, reasons, promptVersion };
  } catch (err) {
    return {
      skipped: true,
      overallPass: true,
      scores: {},
      reasons: [],
      promptVersion,
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    clearTimeout(timer);
  }
}
