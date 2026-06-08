/**
 * 从 orchestrator 流式 JSON 输出中提取用户可见 message 字段（best-effort，支持不完整 JSON）。
 */
export function extractPerformanceStreamMessage(assembled: string): string {
  const raw = String(assembled ?? "").trim();
  if (!raw || raw.includes('"tool_calls"')) return "";
  try {
    const parsed = JSON.parse(raw) as { message?: unknown };
    if (typeof parsed.message === "string") return parsed.message;
  } catch {
    const closed = raw.match(/"message"\s*:\s*"((?:[^"\\]|\\.)*)"/s);
    if (closed?.[1] !== undefined) {
      try {
        return JSON.parse(`"${closed[1]}"`) as string;
      } catch {
        return closed[1].replace(/\\n/g, "\n").replace(/\\"/g, '"').replace(/\\\\/g, "\\");
      }
    }
    const open = raw.match(/"message"\s*:\s*"((?:[^"\\]|\\.)*)$/s);
    if (open?.[1] !== undefined) {
      return open[1].replace(/\\n/g, "\n").replace(/\\"/g, '"').replace(/\\\\/g, "\\");
    }
  }
  return "";
}
