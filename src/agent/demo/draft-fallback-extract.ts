import { logStructured } from "../../infra/logger";
import type { OrchestratorDraft, OrchestratorTask } from "./llm-types";

export function readDraftFallbackEnabled(): boolean {
  return String(process.env.DRAFT_FALLBACK_EXTRACT_ENABLED ?? "1").trim() !== "0";
}

function countLines(text: string): number {
  if (!text.trim()) return 0;
  return text.split(/\r?\n/).length;
}

function hasBoldOrColon(text: string): boolean {
  return text.includes(":") || /\*\*[^*]+\*\*/.test(text);
}

/**
 * 判断 assistant message 是否像「任务草案」Markdown，用于触发二次抽取。
 * 满足任意 2 条即 true（降低误触发）；排除 [system_note] 锚点回声。
 */
export function looksLikeTaskDraftMessage(markdown: string): boolean {
  const s = String(markdown ?? "").trim();
  if (!s) return false;
  if (s.startsWith("[system_note]")) return false;
  const shortArchiveEcho =
    s.length < 80
    && /已切回|已归档|已切到|已切换到新任务|已开新任务/.test(s)
    && !/\|/.test(s);
  if (shortArchiveEcho) return false;

  let score = 0;
  if (/任务草案|草案预览|行动草案|子任务|任务分配|负责人|拆解|待派发/.test(s)) score += 1;
  if (/\|\s*(ID|子任务|任务|负责人|截止)/i.test(s)) score += 1;
  if (/\btask_\d+\b/i.test(s)) score += 1;
  if (countLines(s) > 8 && hasBoldOrColon(s)) score += 1;
  return score >= 2;
}

function stripCodeFence(raw: string): string {
  const m = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return (m?.[1] ?? raw).trim();
}

function normalizeStringArray(input: unknown): string[] {
  if (typeof input === "string" && input.trim()) return [input.trim()];
  if (!Array.isArray(input)) return [];
  return (input as unknown[])
    .map((x) => (typeof x === "string" ? x.trim() : ""))
    .filter(Boolean);
}

function normalizeTask(raw: unknown, index: number): OrchestratorTask {
  const r = (raw && typeof raw === "object" && !Array.isArray(raw))
    ? raw as Record<string, unknown>
    : {} as Record<string, unknown>;

  const timeNodeRaw = (r.timeNode && typeof r.timeNode === "object" && !Array.isArray(r.timeNode))
    ? r.timeNode as Record<string, unknown>
    : {} as Record<string, unknown>;

  const scopeRaw = (r.scope && typeof r.scope === "object" && !Array.isArray(r.scope))
    ? r.scope as Record<string, unknown>
    : {} as Record<string, unknown>;

  return {
    id: String(r.id ?? `task_${index + 1}`).trim() || `task_${index + 1}`,
    title: String(r.title ?? "").trim(),
    objective: String(r.objective ?? "").trim(),
    deliverables: normalizeStringArray(r.deliverables),
    completionCriteria: normalizeStringArray(r.completionCriteria),
    timeNode: {
      startAt: String(timeNodeRaw.startAt ?? r.startAt ?? "").trim() || undefined,
      dueAt: String(timeNodeRaw.dueAt ?? r.dueAt ?? "待确认").trim() || "待确认",
      checkpoints: normalizeStringArray(timeNodeRaw.checkpoints),
    },
    feedbackFrequency: String(r.feedbackFrequency ?? "待确认").trim() || "待确认",
    dependencyTaskIds: normalizeStringArray(r.dependencyTaskIds ?? r.dependencies),
    risksAndOpenQuestions: normalizeStringArray(r.risksAndOpenQuestions),
    inputMaterials: normalizeStringArray(r.inputMaterials),
    actions: normalizeStringArray(r.actions),
    collaborators: normalizeStringArray(r.collaborators),
    scope: {
      inScope: normalizeStringArray(scopeRaw.inScope),
      outOfScope: normalizeStringArray(scopeRaw.outOfScope),
    },
    assigneeUserId: String(r.assigneeUserId ?? "").trim() || undefined,
  };
}

export interface ExtractStructuredDraftInput {
  message: string;
  modelConfig: { apiKey: string; baseUrl: string; timeoutMs?: number };
  traceId?: string;
}

/**
 * 将仅含 Markdown 的任务草案 message 抽成与 session.latestDraft 兼容的 OrchestratorDraft 结构。
 * 失败返回 null（静默退化）。
 */
export async function extractStructuredDraftFromMessage(
  input: ExtractStructuredDraftInput,
): Promise<OrchestratorDraft | null> {
  const message = String(input.message ?? "").trim();
  if (!message) return null;

  const model =
    String(process.env.DRAFT_FALLBACK_EXTRACT_MODEL ?? "").trim()
    || String(process.env.QWEN_MODEL ?? "").trim()
    || "qwen3.6-flash";
  const maxTokens = Math.max(
    256,
    Number(process.env.DRAFT_FALLBACK_MAX_TOKENS ?? "2000") || 2000,
  );
  const timeoutMs = Math.max(
    3000,
    Number(process.env.DRAFT_FALLBACK_TIMEOUT_MS ?? "") || input.modelConfig.timeoutMs || 10000,
  );

  const system = [
    "你是 Markdown → 结构化 JSON 抽取器。仅基于用户给定的 Markdown 抽取，禁止编造任何文本未出现的字段。",
    "仅输出一个 JSON 对象（无解释、无 Markdown 围栏），顶层字段：",
    '{ "title": string, "objective": string, "background": string, "tasks": [ {',
    '  "id": string, "title": string, "objective": string,',
    '  "deliverables": string[], "completionCriteria": string[],',
    '  "inputMaterials": string[], "actions": string[], "collaborators": string[],',
    '  "scope": { "inScope": string[], "outOfScope": string[] },',
    '  "dependencyTaskIds": string[], "risksAndOpenQuestions": string[],',
    '  "timeNode": { "startAt": string, "dueAt": string, "checkpoints": string[] },',
    '  "feedbackFrequency": string',
    "} ] }",
    "未识别到的数组字段给 []；字符串缺失给 \"\"；dueAt 缺失给 \"待确认\"；feedbackFrequency 缺失给 \"待确认\"。",
    "objective：抽取整体任务目标（从标题/描述段落推断）。",
    "background：抽取触发背景/来由（从描述段落推断，无则给 \"\"）。",
    "禁止把姓名、userId、日期、设备型号编造进缺失字段。",
  ].join("\n");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = Date.now();
  try {
    const url = `${input.modelConfig.baseUrl.replace(/\/$/, "")}/chat/completions`;
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${input.modelConfig.apiKey}`,
      },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        temperature: 0,
        max_tokens: maxTokens,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: message },
        ],
      }),
    });
    if (!resp.ok) {
      logStructured({
        event: "draft_fallback_extract_failed",
        traceId: input.traceId ?? null,
        reason: `http_${resp.status}`,
        llmMs: Date.now() - started,
      });
      return null;
    }
    const json = (await resp.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const raw = String(json.choices?.[0]?.message?.content ?? "").trim();
    if (!raw) {
      logStructured({
        event: "draft_fallback_extract_failed",
        traceId: input.traceId ?? null,
        reason: "empty_content",
        llmMs: Date.now() - started,
      });
      return null;
    }
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(stripCodeFence(raw)) as Record<string, unknown>;
    } catch (e) {
      logStructured({
        event: "draft_fallback_extract_failed",
        traceId: input.traceId ?? null,
        reason: e instanceof Error ? e.message : "json_parse",
        llmMs: Date.now() - started,
      });
      return null;
    }

    const rawTasks = Array.isArray(parsed.tasks) ? parsed.tasks : [];
    if (rawTasks.length === 0) {
      logStructured({
        event: "draft_fallback_extract_failed",
        traceId: input.traceId ?? null,
        reason: "empty_tasks",
        llmMs: Date.now() - started,
      });
      return null;
    }

    const tasks: OrchestratorTask[] = rawTasks.map((t, i) => normalizeTask(t, i));

    const title = String(parsed.title ?? "").trim() || String(tasks[0]?.title ?? "").trim() || "任务草案";
    const objective = String(parsed.objective ?? "").trim();
    const background = String(parsed.background ?? "").trim();

    const out: OrchestratorDraft = {
      title,
      objective,
      background,
      tasks,
      extractedBy: "draft_fallback_extract",
      extractedAt: new Date().toISOString(),
    };

    logStructured({
      event: "draft_fallback_extract_ok",
      traceId: input.traceId ?? null,
      taskCount: tasks.length,
      llmMs: Date.now() - started,
    });
    return out;
  } catch (e) {
    logStructured({
      event: "draft_fallback_extract_failed",
      traceId: input.traceId ?? null,
      reason: e instanceof Error ? e.message : String(e),
      llmMs: Date.now() - started,
    });
    return null;
  } finally {
    clearTimeout(timer);
  }
}
