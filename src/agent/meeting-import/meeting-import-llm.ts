import { logStructured } from "../../infra/logger";
import type { MeetingImportPolicy } from "./meeting-import-policy";

export type MeetingImportLlmFn = (input: {
  system: string;
  user: string;
  policy: MeetingImportPolicy;
}) => Promise<string | null>;

let meetingImportLlmForTest: MeetingImportLlmFn | undefined;

export function __setMeetingImportLlmForTest(fn: MeetingImportLlmFn | undefined): void {
  meetingImportLlmForTest = fn;
}

async function callDefaultLlm(input: {
  system: string;
  user: string;
  policy: MeetingImportPolicy;
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
      temperature: 0.2,
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

export async function callMeetingImportLlm(input: {
  system: string;
  user: string;
  policy: MeetingImportPolicy;
}): Promise<string | null> {
  const startedAt = Date.now();
  const llm = meetingImportLlmForTest ?? callDefaultLlm;
  try {
    const result = await Promise.race([
      llm(input),
      new Promise<null>((resolve) => {
        setTimeout(() => resolve(null), input.policy.llmTimeoutMs);
      }),
    ]);
    logStructured({
      event: result ? "meeting_import_llm_ok" : "meeting_import_llm_empty",
      durationMs: Date.now() - startedAt,
    });
    return result;
  } catch (err) {
    logStructured({
      event: "meeting_import_llm_error",
      durationMs: Date.now() - startedAt,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}
