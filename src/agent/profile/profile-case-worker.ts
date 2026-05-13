import { createPeopleDirectoryStore, mergeCasesByOutcome, type EmployeeCapabilityProfileRow } from "../../infra/people-directory-store";
import { createWorkbenchFormalTaskStore } from "../../infra/workbench-formal-task-store";
import { logStructured } from "../../infra/logger";
import { loadQwenPlannerConfigFromEnv } from "../demo/qwen-planner";
import { parseAssistantJsonPayload } from "../demo/qwen-compatible-client";

/** Stable outcome key for idempotent merges (同一子任务多次触发覆盖同一条 case). */
export function profileCaseOutcomeKeyForSubtask(subtaskId: string): string {
  return `workbench_subtask:${String(subtaskId ?? "").trim()}`;
}

function readProfileCaseWorkerEnabled(): boolean {
  const v = String(process.env.PROFILE_CASE_WORKER_ENABLED ?? "1").trim().toLowerCase();
  return v !== "0" && v !== "false" && v !== "no";
}

function truncate(s: string, max: number): string {
  const t = String(s ?? "").trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max)}…`;
}

async function callLlmCaseExtraction(input: {
  taskTitle: string;
  subtaskTitle: string;
  objective?: string;
  deliverables?: string;
  employeeNote: string;
  planId: string;
}): Promise<{ taskType: string; contribution?: string; deliverable?: string; outcome: string } | undefined> {
  const base = loadQwenPlannerConfigFromEnv();
  if (!base?.apiKey) return undefined;

  const model = String(process.env.PROFILE_CASE_WORKER_MODEL ?? base.model).trim() || base.model;
  const maxTokens = Math.min(512, base.maxTokens);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.min(base.timeoutMs, 45000));
  try {
    const endpoint = `${base.baseUrl.replace(/\/$/, "")}/chat/completions`;
    const system = [
      "你是内部员工能力画像助手。根据已完成的子任务与员工填写的完成说明，抽取一条可写入 cases 数组的结构化记录。",
      "只输出 JSON 对象，不要 Markdown 围栏。字段：",
      '- taskType: 短英文或中文标识任务类型（如 "quality_incident" / "研发支持"），<=48 字符',
      "- contribution: 可选，员工贡献角色简述，<=120 字符",
      "- deliverable: 可选，交付物简述，<=120 字符",
      "- outcome: 一句话结果摘要，<=160 字符",
    ].join("\n");
    const user = [
      `planId=${input.planId}`,
      `taskTitle=${truncate(input.taskTitle, 200)}`,
      `subtaskTitle=${truncate(input.subtaskTitle, 200)}`,
      input.objective ? `objective=${truncate(input.objective, 400)}` : "",
      input.deliverables ? `deliverables=${truncate(input.deliverables, 400)}` : "",
      `employeeCompletionNote=${truncate(input.employeeNote, 1200)}`,
    ]
      .filter(Boolean)
      .join("\n");

    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${base.apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        max_tokens: maxTokens,
        stream: false,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Qwen API failed: ${res.status}${text ? `: ${truncate(text, 200)}` : ""}`);
    }
    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string | null } }>;
    };
    const content = json.choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content.trim()) return undefined;
    const parsed = parseAssistantJsonPayload(content) as Record<string, unknown>;
    const taskType = String(parsed.taskType ?? "").trim();
    const outcome = String(parsed.outcome ?? "").trim();
    if (!taskType || !outcome) return undefined;
    return {
      taskType: truncate(taskType, 48),
      contribution: truncate(String(parsed.contribution ?? "").trim(), 120) || undefined,
      deliverable: truncate(String(parsed.deliverable ?? "").trim(), 120) || undefined,
      outcome: truncate(outcome, 160),
    };
  } catch (err) {
    logStructured({
      event: "profile_case_worker_llm_failed",
      reason: err instanceof Error ? err.message : String(err),
    });
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

function ruleBasedCase(input: {
  subtaskTitle: string;
  employeeNote: string;
  outcomeKey: string;
}): EmployeeCapabilityProfileRow["cases"][number] {
  return {
    taskType: "workbench_subtask",
    contribution: truncate(input.employeeNote, 120) || "completed",
    deliverable: truncate(input.subtaskTitle, 120),
    outcome: input.outcomeKey,
  };
}

/**
 * 子任务标记 DONE 后异步调用：抽取/合并一条 case 写入 SQLite，并写 profile event。无 Ding 通知。
 */
export async function runProfileCaseWorkerOnce(input: {
  subtaskId: string;
  assigneeUserId: string;
}): Promise<void> {
  if (!readProfileCaseWorkerEnabled()) return;

  const subtaskId = String(input.subtaskId ?? "").trim();
  const assigneeUserId = String(input.assigneeUserId ?? "").trim();
  if (!subtaskId || !assigneeUserId) return;

  const taskStore = createWorkbenchFormalTaskStore();
  const pair = taskStore.getSubtaskWithTask(subtaskId);
  if (!pair) {
    logStructured({ event: "profile_case_worker_skip", reason: "subtask_not_found", subtaskId });
    return;
  }
  if (pair.subtask.assigneeUserId !== assigneeUserId) {
    logStructured({ event: "profile_case_worker_skip", reason: "assignee_mismatch", subtaskId });
    return;
  }
  if (pair.subtask.status !== "DONE") {
    logStructured({ event: "profile_case_worker_skip", reason: "not_done", subtaskId, status: pair.subtask.status });
    return;
  }

  const outcomeKey = profileCaseOutcomeKeyForSubtask(subtaskId);
  const note = String(pair.subtask.progressNote ?? "").trim();
  if (!note) {
    logStructured({ event: "profile_case_worker_skip", reason: "empty_note", subtaskId });
    return;
  }

  const extracted =
    (await callLlmCaseExtraction({
      taskTitle: pair.task.title,
      subtaskTitle: pair.subtask.title,
      objective: pair.subtask.objective,
      deliverables: pair.subtask.deliverables,
      employeeNote: note,
      planId: pair.task.planId,
    })) ?? undefined;

  const newCase: EmployeeCapabilityProfileRow["cases"][number] = extracted
    ? {
        taskType: extracted.taskType,
        contribution: extracted.contribution || truncate(extracted.outcome, 120),
        deliverable: extracted.deliverable || truncate(pair.subtask.title, 120),
        outcome: outcomeKey,
      }
    : {
        ...ruleBasedCase({
          subtaskTitle: pair.subtask.title,
          employeeNote: note,
          outcomeKey,
        }),
      };

  const peopleStore = createPeopleDirectoryStore();
  try {
    const existing = peopleStore.getProfile(assigneeUserId);
    const base: EmployeeCapabilityProfileRow =
      existing ??
      ({
        userId: assigneeUserId,
        skillTags: [],
        strengths: [],
        boundaries: [],
        cases: [],
        tools: [],
        availability: {},
        updatedAt: new Date().toISOString(),
      } satisfies EmployeeCapabilityProfileRow);

    const mergedCases = mergeCasesByOutcome(base.cases, [newCase]);

    peopleStore.upsertProfile({
      ...base,
      cases: mergedCases,
      source: base.source ?? "agent_case_worker",
      updatedAt: new Date().toISOString(),
    });

    peopleStore.appendProfileEvent({
      userId: assigneeUserId,
      eventType: "CASE_FROM_WORKBENCH_DONE",
      actorUserId: assigneeUserId,
      payload: {
        subtaskId,
        planId: pair.task.planId,
        taskId: pair.task.taskId,
        usedLlm: Boolean(extracted),
      },
    });

    if (String(process.env.PROFILE_CASE_WORKER_SKILL_LOG ?? "").trim() === "1") {
      const hintTags = ["8D", "FMEA", "CAPA", "Python", "DOE"].filter((k) =>
        `${note} ${pair.subtask.title}`.toLowerCase().includes(k.toLowerCase()),
      );
      logStructured({
        event: "profile_case_worker_skill_hint",
        subtaskId,
        userId: assigneeUserId,
        hintTags,
      });
    }

    logStructured({
      event: "profile_case_worker_done",
      subtaskId,
      userId: assigneeUserId,
      planId: pair.task.planId,
      usedLlm: Boolean(extracted),
    });
  } finally {
    peopleStore.close();
  }
}

export function scheduleProfileCaseWorkerAfterDone(input: { subtaskId: string; assigneeUserId: string }): void {
  if (!readProfileCaseWorkerEnabled()) return;
  void runProfileCaseWorkerOnce(input).catch((err) => {
    logStructured({
      event: "profile_case_worker_unhandled_error",
      reason: err instanceof Error ? err.message : String(err),
      subtaskId: input.subtaskId,
    });
  });
}
