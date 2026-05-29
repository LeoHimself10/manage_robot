import { randomUUID } from "node:crypto";
import type { MeetingImportActionItem } from "./types";
import { callMeetingImportLlm, extractJsonFromLlmContent } from "./meeting-import-llm";
import { loadMeetingImportPolicy } from "./meeting-import-policy";

function fallbackExtractItems(text: string): MeetingImportActionItem[] {
  const lines = text.split(/\r?\n/);
  let inActionSection = false;
  const items: MeetingImportActionItem[] = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    if (/action\s*items?|待办|行动项|跟进事项/i.test(line)) {
      inActionSection = true;
      continue;
    }
    if (inActionSection && /^#{1,3}\s/.test(line) && !/action|待办/i.test(line)) {
      break;
    }
    const bullet = line.match(/^(?:[-*•]|\d+[.)）、])\s*(.+)$/);
    if (!bullet && !inActionSection) continue;
    const body = bullet ? bullet[1].trim() : inActionSection ? line : "";
    if (!body || body.length < 4) continue;

    let assigneeName: string | undefined;
    let dueAt: string | undefined;
    let title = body;
    const assigneeMatch = body.match(/(?:负责人|执行人|@)[:：]?\s*([^\s，,;；]+)/);
    if (assigneeMatch) {
      assigneeName = assigneeMatch[1].trim();
      title = body.replace(assigneeMatch[0], "").trim();
    }
    const dueMatch = body.match(/(?:截止|deadline|due)[:：]?\s*(\d{4}[-/]\d{1,2}[-/]\d{1,2})/i);
    if (dueMatch) dueAt = dueMatch[1].replace(/\//g, "-");

    items.push({
      id: `item-${items.length + 1}`,
      title: title.slice(0, 120) || body.slice(0, 120),
      excerpt: body,
      assigneeName,
      dueAt,
    });
  }

  if (items.length === 0) {
    for (const rawLine of lines) {
      const line = rawLine.trim();
      const bullet = line.match(/^(?:[-*•]|\d+[.)）、])\s*(.{6,})$/);
      if (!bullet) continue;
      items.push({
        id: `item-${items.length + 1}`,
        title: bullet[1].trim().slice(0, 120),
        excerpt: bullet[1].trim(),
      });
      if (items.length >= 20) break;
    }
  }

  return items;
}

function normalizeLlmItems(raw: unknown): MeetingImportActionItem[] {
  if (!Array.isArray(raw)) return [];
  const out: MeetingImportActionItem[] = [];
  for (const row of raw) {
    const obj = row && typeof row === "object" ? (row as Record<string, unknown>) : {};
    const title = String(obj.title ?? "").trim();
    const excerpt = String(obj.excerpt ?? title).trim();
    if (!title) continue;
    out.push({
      id: String(obj.id ?? `item-${out.length + 1}`).trim() || `item-${out.length + 1}`,
      title: title.slice(0, 200),
      excerpt: excerpt.slice(0, 500),
      assigneeName: String(obj.assigneeName ?? "").trim() || undefined,
      dueAt: String(obj.dueAt ?? "").trim() || undefined,
      rawSection: String(obj.rawSection ?? "").trim() || undefined,
    });
  }
  return out;
}

export async function extractActionItemsFromText(input: {
  text: string;
  meetingTitle?: string;
  meetingDate?: string;
}): Promise<MeetingImportActionItem[]> {
  const policy = loadMeetingImportPolicy();
  const content = await callMeetingImportLlm({
    policy,
    system:
      "你是会议记录分析助手。从用户提供的会议文本中提取 Action Items / 待办事项，输出 JSON 数组：" +
      '[{"id":"item-1","title":"简短标题","excerpt":"原句","assigneeName":"可选","dueAt":"YYYY-MM-DD 可选"}]。' +
      "只提取明确待办，不要编造。无待办则返回 []。",
    user: JSON.stringify({
      meetingTitle: input.meetingTitle ?? "",
      meetingDate: input.meetingDate ?? "",
      text: input.text.slice(0, 24_000),
    }),
  });

  if (content) {
    const parsed = extractJsonFromLlmContent(content);
    const items = normalizeLlmItems(parsed);
    if (items.length > 0) return items;
  }

  const fallback = fallbackExtractItems(input.text);
  return fallback.map((item) => ({
    ...item,
    id: item.id || `item-${randomUUID().slice(0, 8)}`,
  }));
}
