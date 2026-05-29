import { logStructured } from "../../infra/logger";
import type { WeeklyDashboardFacts } from "./weekly-dashboard-facts";
import { renderWeeklyAdvisorTemplate, type WeeklyAdvisorResponse } from "./weekly-dashboard-advisor-templates";
import type { WeeklyDashboardPolicy } from "./weekly-dashboard-policy";

type WeeklyAdvisorLlm = (facts: WeeklyDashboardFacts, policy: WeeklyDashboardPolicy) => Promise<WeeklyAdvisorResponse | null>;

let weeklyAdvisorLlmForTest: WeeklyAdvisorLlm | undefined;

export function __setWeeklyAdvisorLlmForTest(fn: WeeklyAdvisorLlm | undefined): void {
  weeklyAdvisorLlmForTest = fn;
}

function slimFacts(facts: WeeklyDashboardFacts): Record<string, unknown> {
  const subtaskRows = facts.tasks.flatMap((g) =>
    g.subtasks.map((s) => ({
      taskTitle: g.task.title,
      subtaskTitle: s.title,
      status: s.status,
      dueAt: s.dueAt,
    })),
  );
  return {
    week: facts.week,
    approxHistoricalState: facts.approxHistoricalState,
    kpi: facts.kpi,
    taskCount: facts.tasks.length,
    blockedOrOverdueTasks: subtaskRows
      .filter((s) => s.status === "BLOCKED" || (s.dueAt && Date.parse(s.dueAt) < Date.now()))
      .slice(0, 8),
    inProgressTasks: subtaskRows.filter((s) => s.status === "IN_PROGRESS").slice(0, 8),
    waitingAcceptTasks: subtaskRows.filter((s) => s.status === "ASSIGNED").slice(0, 6),
    dueNextWeekHint: facts.kpi.dueNextWeek,
    recentEvents: facts.feed.items.slice(0, 12).map((e) => ({
      eventType: e.eventType,
      taskTitle: e.taskTitle,
      subtaskTitle: e.subtaskTitle,
      note: e.note,
      occurredAt: e.occurredAt,
    })),
  };
}

function normalizeSections(raw: unknown): WeeklyAdvisorResponse | null {
  const obj = raw && typeof raw === "object" ? raw as { sections?: unknown } : {};
  if (!Array.isArray(obj.sections)) return null;
  const sections = obj.sections
    .map((s) => {
      const row = s && typeof s === "object" ? s as { title?: unknown; bullets?: unknown } : {};
      const title = String(row.title ?? "").trim();
      const bullets = Array.isArray(row.bullets)
        ? row.bullets.map((b) => String(b ?? "").trim()).filter(Boolean).slice(0, 5)
        : [];
      return title && bullets.length > 0 ? { title, bullets } : null;
    })
    .filter((s): s is { title: string; bullets: string[] } => Boolean(s))
    .slice(0, 4);
  return sections.length > 0 ? { sections, renderSource: "llm" } : null;
}

async function callDefaultLlm(facts: WeeklyDashboardFacts, policy: WeeklyDashboardPolicy): Promise<WeeklyAdvisorResponse | null> {
  if (!policy.advisorLlmEnabled || !policy.advisorLlmApiKey) return null;
  const response = await fetch(`${policy.advisorLlmBaseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${policy.advisorLlmApiKey}`,
    },
    body: JSON.stringify({
      model: policy.advisorLlmModel,
      temperature: 0.2,
      max_tokens: policy.advisorLlmMaxTokens,
      enable_thinking: false,
      messages: [
        {
          role: "system",
          content:
            "你是项目经理周会助手。先根据输入 JSON 中的 KPI、动态与任务状态总结「本周进展」，再给出可执行的「下周推进建议」（按优先级排序）。只输出 JSON：{\"sections\":[{\"title\":\"本周进展\",\"bullets\":[\"...\"]},{\"title\":\"下周推进建议\",\"bullets\":[\"...\"]}]}。不要编造不存在的人名、任务或日期。",
        },
        {
          role: "user",
          content: JSON.stringify(slimFacts(facts)),
        },
      ],
    }),
  });
  if (!response.ok) return null;
  const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
  const content = String(data.choices?.[0]?.message?.content ?? "").trim();
  const match = content.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return normalizeSections(JSON.parse(match[0]));
  } catch {
    return null;
  }
}

export async function summarizeWeeklyAdvisorWithLlm(
  facts: WeeklyDashboardFacts,
  policy: WeeklyDashboardPolicy,
): Promise<WeeklyAdvisorResponse> {
  const startedAt = Date.now();
  let timedOut = false;
  const llm = weeklyAdvisorLlmForTest ?? callDefaultLlm;
  try {
    const result = await Promise.race([
      llm(facts, policy),
      new Promise<null>((resolve) => {
        setTimeout(() => {
          timedOut = true;
          resolve(null);
        }, policy.advisorLlmTimeoutMs);
      }),
    ]);
    if (result) {
      logStructured({
        event: "weekly_advisor_llm_ok",
        durationMs: Date.now() - startedAt,
        sectionCount: result.sections.length,
      });
      return { ...result, renderSource: "llm" };
    }
  } catch (err) {
    logStructured({
      event: "weekly_advisor_llm_fallback",
      durationMs: Date.now() - startedAt,
      error: err instanceof Error ? err.message : String(err),
    });
  }
  const fallback = renderWeeklyAdvisorTemplate(facts);
  return { ...fallback, timedOut: timedOut || undefined };
}
