import type { DingtalkTurnEvalResult } from "./dingtalk-turn-eval-harness";

export interface ReadUrlTurnExpect {
  id: string;
  /** Must appear in toolInvocationNames (order preserved check uses includes) */
  expectToolsInclude?: string[];
  expectToolsExclude?: string[];
  /** Outbound must match at least one (case insensitive) */
  expectOutboundAny?: RegExp[];
  /** Outbound must not match any */
  forbidOutboundAny?: RegExp[];
  expectDraftJson?: boolean;
  minOutboundLength?: number;
}

export function assertReadUrlTurn(
  turn: Pick<DingtalkTurnEvalResult, "tools" | "outboundMessage" | "hasDraftJson" | "stopReason">,
  expect: ReadUrlTurnExpect,
): string[] {
  const reasons: string[] = [];
  const outbound = String(turn.outboundMessage ?? "").trim();
  const tools = turn.tools ?? [];

  for (const t of expect.expectToolsInclude ?? []) {
    if (!tools.includes(t)) reasons.push(`missing tool: ${t} (got ${tools.join(",") || "none"})`);
  }
  for (const t of expect.expectToolsExclude ?? []) {
    if (tools.includes(t)) reasons.push(`forbidden tool called: ${t}`);
  }

  const minLen = expect.minOutboundLength ?? 12;
  if (outbound.length < minLen) {
    reasons.push(`outbound too short (${outbound.length}<${minLen})`);
  }

  for (const re of expect.expectOutboundAny ?? []) {
    if (!re.test(outbound)) reasons.push(`outbound missing pattern: ${re.source}`);
  }
  for (const re of expect.forbidOutboundAny ?? []) {
    if (re.test(outbound)) reasons.push(`outbound forbidden pattern: ${re.source}`);
  }

  if (expect.expectDraftJson === true && !turn.hasDraftJson) {
    reasons.push("expected draft JSON");
  }
  if (expect.expectDraftJson === false && turn.hasDraftJson) {
    reasons.push("expected no draft JSON (background-only turn)");
  }

  if (turn.stopReason === "max_turns_exceeded") {
    reasons.push("max_turns_exceeded");
  }

  return reasons;
}

/** User-facing reply must not leak tool names. */
export function assertReadUrlAssistantHygiene(message: string): string[] {
  const reasons: string[] = [];
  const banned = [/\bread_url\b/i, /\bsearch_web\b/i, /\[links\]/i];
  for (const re of banned) {
    if (re.test(message)) reasons.push(`assistant leaks: ${re.source}`);
  }
  return reasons;
}

export function assertExtractedBackground(
  background: string,
  expect: {
    mustContain?: string[];
    mustNotContain?: string[];
    minLength?: number;
  },
): string[] {
  const reasons: string[] = [];
  const text = background.trim();
  if ((expect.minLength ?? 1) > 0 && text.length < (expect.minLength ?? 1)) {
    reasons.push(`background empty or too short (${text.length})`);
  }
  for (const s of expect.mustContain ?? []) {
    if (!text.includes(s)) reasons.push(`background missing: ${s}`);
  }
  for (const s of expect.mustNotContain ?? []) {
    if (text.includes(s)) reasons.push(`background must not contain: ${s}`);
  }
  return reasons;
}
