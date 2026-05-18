import { coerceLlmPlanPayload } from "./llm-schema";
import type { TaskPackage } from "../../domain/task-package";
import { logStructured } from "../../infra/logger";

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
  if (
    /任务草案|子任务|任务分配|负责人|拆解|待派发/.test(s)
  ) {
    score += 1;
  }
  if (/\|\s*(ID|子任务|任务|负责人|截止)/i.test(s)) {
    score += 1;
  }
  if (/\btask_\d+\b/i.test(s)) {
    score += 1;
  }
  if (countLines(s) > 8 && hasBoldOrColon(s)) {
    score += 1;
  }
  return score >= 2;
}

function stripCodeFence(raw: string): string {
  const m = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return (m?.[1] ?? raw).trim();
}

function defaultQualityPayloadForCoerce(
  parsed: Record<string, unknown>,
): Record<string, unknown> {
  const tasks = Array.isArray(parsed.tasks) ? parsed.tasks : [];
  return {
    classification: {
      domain: "QUALITY",
      subtype: "CUSTOMER_COMPLAINT_OR_FIELD_ISSUE",
      confidence: "MEDIUM",
      rationale: [],
      missingInformation: [],
    },
    openQuestions: [],
    capaAdvisory: {
      advisory: "INSUFFICIENT_INFO",
      rationale: ["由 Markdown 草案抽取生成；CAPA 判定以主管与 QMS 为准"],
      disclaimer:
        "该建议仅用于任务拆解与质量沟通参考，最终是否开启 CAPA 以质量授权人员和公司 QMS 流程判定为准。",
      promptingQuestions: [],
    },
    assistantMessage: "",
    tasks,
  };
}

function asPlainObject(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function normalizeStringArrayLoose(input: unknown): string[] {
  if (typeof input === "string" && input.trim()) return [input.trim()];
  if (!Array.isArray(input)) return [];
  return input
    .map((x) => (typeof x === "string" ? x.trim() : ""))
    .filter(Boolean);
}

function mergeTasksWithRaw(
  coercedTasks: TaskPackage[],
  rawTasks: unknown[],
): Array<Record<string, unknown>> {
  return coercedTasks.map((t, index) => {
    const raw = asPlainObject(rawTasks[index]) ?? {};
    const rawCollab = normalizeStringArrayLoose(raw.collaborators);
    const scope = asPlainObject(raw.scope) ?? {};
    const inScope = normalizeStringArrayLoose(scope.inScope);
    const outOfScope = normalizeStringArrayLoose(scope.outOfScope);
    const mergedScope =
      inScope.length > 0 || outOfScope.length > 0
        ? { inScope, outOfScope }
        : undefined;
    return {
      ...(t as unknown as Record<string, unknown>),
      collaborators: rawCollab.length > 0 ? rawCollab : t.collaborators,
      ...(mergedScope ? { scope: mergedScope } : {}),
    };
  });
}

export interface ExtractStructuredDraftInput {
  message: string;
  modelConfig: { apiKey: string; baseUrl: string; timeoutMs?: number };
  traceId?: string;
}

/**
 * 将仅含 Markdown 的任务草案 message 抽成与 save_draft / session.latestDraft 兼容的结构。
 * 失败返回 null（静默退化）。
 */
export async function extractStructuredDraftFromMessage(
  input: ExtractStructuredDraftInput,
): Promise<Record<string, unknown> | null> {
  const message = String(input.message ?? "").trim();
  if (!message) return null;

  const model =
    String(process.env.DRAFT_FALLBACK_EXTRACT_MODEL ?? "").trim()
    || String(process.env.QWEN_MODEL ?? "").trim()
    || "qwen3.6-flash";
  const maxTokens = Math.max(
    256,
    Number(process.env.DRAFT_FALLBACK_MAX_TOKENS ?? "1500") || 1500,
  );
  const timeoutMs = Math.max(
    3000,
    Number(process.env.DRAFT_FALLBACK_TIMEOUT_MS ?? "") || input.modelConfig.timeoutMs || 8000,
  );

  const system = [
    "你是 Markdown → 结构化 JSON 抽取器。仅基于用户给定的 Markdown 抽取，禁止编造任何文本未出现的字段。",
    "仅输出一个 JSON 对象（无解释、无 Markdown 围栏），顶层字段：",
    '{ "title": string, "description": string, "tasks": [ {',
    '  "id": string, "title": string, "objective": string,',
    '  "deliverables": string[], "completionCriteria": string[],',
    '  "inputMaterials": string[], "actions": string[], "collaborators": string[],',
    '  "scope": { "inScope": string[], "outOfScope": string[] },',
    '  "dependencyTaskIds": string[], "risksAndOpenQuestions": string[],',
    '  "timeNode": { "dueAt": string, "checkpoints": string[] },',
    '  "feedbackFrequency": string',
    "} ] }",
    "未识别到的数组字段给 []；字符串缺失给 \"\"；dueAt 缺失给 \"待确认\"；feedbackFrequency 缺失给 \"待确认\"。",
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
    const wrapped = defaultQualityPayloadForCoerce(parsed);
    const coerced = coerceLlmPlanPayload(wrapped);
    if (!coerced.tasks.length) {
      logStructured({
        event: "draft_fallback_extract_failed",
        traceId: input.traceId ?? null,
        reason: "empty_tasks_after_coerce",
        llmMs: Date.now() - started,
      });
      return null;
    }
    const rawTasks = Array.isArray(parsed.tasks) ? parsed.tasks : [];
    const mergedTasks = mergeTasksWithRaw(coerced.tasks, rawTasks);
    // 补齐缺失 id（coerce 可能得到空 id）
    for (let i = 0; i < mergedTasks.length; i += 1) {
      const row = mergedTasks[i]!;
      const id = String(row.id ?? "").trim();
      if (!id) row.id = `task_${i + 1}`;
    }
    const title = String(parsed.title ?? "").trim()
      || String(mergedTasks[0]?.title ?? "").trim()
      || "任务草案";
    const description = String(parsed.description ?? "").trim();
    const out: Record<string, unknown> = {
      title,
      description,
      classification: coerced.classification,
      capaAdvisory: coerced.capaAdvisory,
      openQuestions: coerced.openQuestions,
      gateSelfCheck: coerced.gateSelfCheck,
      responseIntent: coerced.responseIntent,
      assistantMessage: coerced.assistantMessage,
      tasks: mergedTasks,
      extractedBy: "draft_fallback_extract",
      extractedAt: new Date().toISOString(),
    };
    logStructured({
      event: "draft_fallback_extract_ok",
      traceId: input.traceId ?? null,
      taskCount: mergedTasks.length,
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
