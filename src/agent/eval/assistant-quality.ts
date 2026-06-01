/**
 * High-bar assistant (bot) message quality checks for natural-language eval.
 */

import type { PlanSession } from "../../infra/plan-session-store";

const ASSISTANT_TOOL_BANNED = [
  /\bbulk_assign_tasks\b/i,
  /\bsearch_employees\b/i,
  /\bget_employee_details\b/i,
  /\bset_candidate_pool\b/i,
  /\bresolve_roster_names\b/i,
  /\bread_uploaded_roster_text\b/i,
  /\bread_url\b/i,
  /\bprepare_publish_task\b/i,
  /\bpublish_task\b/i,
  /\bupdate_draft_task\b/i,
  /\badd_draft_subtask\b/i,
  /\blist_managed_tasks\b/i,
  /\bassignment JSON\b/i,
  /\bcandidatePool\b/i,
  /\bfileNotes\b/i,
  /\bselfProfile\b/i,
  /\[\s*memory_context\s*\]/i,
  /\buserId\s*[:=]/i,
  /\btaskId\s*[:=]/i,
];

const ASSISTANT_TASK_ID_LITERAL = /\btask_\d+\b/i;
const ASSISTANT_EVAL_USER_ID = /\beval-[a-z0-9-]+\b/i;
const ASSISTANT_LONG_NUMERIC_ID = /\b\d{10,}\b/;

const CLARIFY_WHEN_DRAFT_EXISTS = [
  /请补充以下信息以便我生成正式草案/i,
  /以便我生成正式草案/i,
  /等待您补充/i,
];

export interface AssistantQualityOpts {
  forbidTaskIdLiterals?: boolean;
  forbidEvalUserIds?: boolean;
  draftAlreadyExists?: boolean;
  mustNotContain?: string[];
  minLength?: number;
}

export function assertAssistantMessageQuality(
  message: string,
  opts: AssistantQualityOpts = {},
): string[] {
  const reasons: string[] = [];
  const text = String(message ?? "").trim();
  const minLen = opts.minLength ?? 8;

  if (text.length < minLen) {
    reasons.push(`assistant message too short (${text.length}<${minLen})`);
  }

  for (const re of ASSISTANT_TOOL_BANNED) {
    if (re.test(text)) {
      reasons.push(`assistant leaks internal token: ${re.source}`);
    }
  }

  if (opts.forbidTaskIdLiterals && ASSISTANT_TASK_ID_LITERAL.test(text)) {
    reasons.push("assistant mentions task_N literal id (use 任务N or title)");
  }

  if (opts.forbidEvalUserIds !== false && ASSISTANT_EVAL_USER_ID.test(text)) {
    reasons.push("assistant mentions eval internal userId");
  }

  if (ASSISTANT_LONG_NUMERIC_ID.test(text)) {
    reasons.push("assistant mentions long numeric userId");
  }

  if (opts.draftAlreadyExists) {
    for (const re of CLARIFY_WHEN_DRAFT_EXISTS) {
      if (re.test(text)) reasons.push(`assistant CLARIFY tone with existing draft: ${re.source}`);
    }
  }

  for (const frag of opts.mustNotContain ?? []) {
    if (text.includes(frag)) reasons.push(`assistant must not contain "${frag}"`);
  }

  return reasons;
}

export function assertPoolFileNotesCoverage(
  session: PlanSession,
  minRatio: number,
): string[] {
  const pool = session.candidatePool;
  if (!pool?.entries?.length) {
    return ["candidatePool missing after roster turn"];
  }
  const withNotes = pool.entries.filter((e) => String(e.fileNotes ?? "").trim().length > 8);
  const ratio = withNotes.length / pool.entries.length;
  if (ratio + 1e-9 < minRatio) {
    return [
      `fileNotes coverage ${ratio.toFixed(2)}<${minRatio} (${withNotes.length}/${pool.entries.length})`,
    ];
  }
  return [];
}

export function assertAssigneesFromPool(
  session: PlanSession,
  allowedUserIds: Set<string>,
): string[] {
  const assignment = session.latestAssignment as { assignments?: unknown[] } | undefined;
  const rows = Array.isArray(assignment?.assignments) ? assignment!.assignments! : [];
  const reasons: string[] = [];
  for (const raw of rows) {
    if (!raw || typeof raw !== "object") continue;
    const primary = (raw as { primary?: { userId?: string } }).primary;
    const uid = String(primary?.userId ?? "").trim();
    if (uid && !allowedUserIds.has(uid)) {
      reasons.push(`assignee ${uid} not in roster pool`);
    }
  }
  return reasons;
}

export function assertDistinctAssigneeCount(
  session: PlanSession,
  minDistinct: number,
): string[] {
  const assignment = session.latestAssignment as { assignments?: unknown[] } | undefined;
  const rows = Array.isArray(assignment?.assignments) ? assignment!.assignments! : [];
  const ids = new Set<string>();
  for (const raw of rows) {
    if (!raw || typeof raw !== "object") continue;
    const uid = String((raw as { primary?: { userId?: string } }).primary?.userId ?? "").trim();
    if (uid) ids.add(uid);
  }
  if (ids.size < minDistinct) {
    return [`distinct assignees ${ids.size}<${minDistinct}`];
  }
  return [];
}
