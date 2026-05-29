import type { MeetingImportActionItem, MeetingImportParentSuggestion } from "./types";
import { callMeetingImportLlm, extractJsonFromLlmContent } from "./meeting-import-llm";
import { loadMeetingImportPolicy } from "./meeting-import-policy";

function fallbackGroup(input: {
  items: MeetingImportActionItem[];
  tasks: Array<{ taskNo: string; planId: string; title: string }>;
  meetingTitle?: string;
}): MeetingImportParentSuggestion[] {
  const themeTitle = input.meetingTitle?.trim() || "会议待办跟进";
  return input.items.map((item) => {
    for (const task of input.tasks) {
      if (
        item.title.includes(task.title.slice(0, 6)) ||
        task.title.includes(item.title.slice(0, 6))
      ) {
        return {
          kind: "existing",
          taskNo: task.taskNo,
          planId: task.planId,
          existingTaskTitle: task.title,
          reason: `标题与已有大任务「${task.title}」相关`,
        };
      }
    }
    return {
      kind: "new",
      suggestedTitle: themeTitle,
      themeKey: "meeting-default",
      reason: "建议归入本场会议新建大任务",
    };
  });
}

function normalizeParentRows(
  raw: unknown,
  items: MeetingImportActionItem[],
  tasks: Array<{ taskNo: string; planId: string; title: string }>,
): MeetingImportParentSuggestion[] {
  if (!Array.isArray(raw)) return fallbackGroup({ items, tasks });
  return items.map((item, index) => {
    const row = raw[index] && typeof raw[index] === "object" ? (raw[index] as Record<string, unknown>) : {};
    const kind = String(row.kind ?? "").trim() === "existing" ? "existing" : "new";
    if (kind === "existing") {
      const taskNo = String(row.taskNo ?? "").trim();
      const task = tasks.find((t) => t.taskNo === taskNo);
      return {
        kind: "existing",
        taskNo: task?.taskNo ?? taskNo,
        planId: task?.planId ?? (String(row.planId ?? "").trim() || undefined),
        existingTaskTitle: task?.title ?? (String(row.existingTaskTitle ?? "").trim() || undefined),
        reason: String(row.reason ?? "").trim() || undefined,
      };
    }
    return {
      kind: "new",
      suggestedTitle: String(row.suggestedTitle ?? item.title).trim().slice(0, 120),
      themeKey: String(row.themeKey ?? "theme-1").trim(),
      reason: String(row.reason ?? "").trim() || undefined,
    };
  });
}

export async function groupParentTasksForItems(input: {
  items: MeetingImportActionItem[];
  tasks: Array<{ taskNo: string; planId: string; title: string }>;
  meetingTitle?: string;
}): Promise<MeetingImportParentSuggestion[]> {
  if (input.items.length === 0) return [];
  const policy = loadMeetingImportPolicy();
  const content = await callMeetingImportLlm({
    policy,
    system:
      "你是项目管理助手。为每条会议待办建议父任务：kind=existing 时给出 taskNo；kind=new 时给出 suggestedTitle 与 themeKey（相近待办共用 themeKey，全场约 2-3 个 themeKey）。" +
      '输出 JSON 数组：[{"itemId":"...","kind":"existing|new","taskNo?":"","suggestedTitle?":"","themeKey?":"","reason":""}]',
    user: JSON.stringify({
      meetingTitle: input.meetingTitle ?? "",
      existingTasks: input.tasks.slice(0, 40),
      items: input.items.map((i) => ({ id: i.id, title: i.title, excerpt: i.excerpt })),
    }),
  });

  if (content) {
    const parsed = extractJsonFromLlmContent(content);
    if (Array.isArray(parsed)) {
      const byId = new Map<string, Record<string, unknown>>();
      for (const row of parsed) {
        if (row && typeof row === "object") {
          const obj = row as Record<string, unknown>;
          byId.set(String(obj.itemId ?? ""), obj);
        }
      }
      const ordered = input.items.map((item, index) => byId.get(item.id) ?? parsed[index]);
      return normalizeParentRows(ordered, input.items, input.tasks);
    }
  }

  return fallbackGroup(input);
}
