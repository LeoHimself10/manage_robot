import type { ToolDefinition, ToolHandler } from "../demo/qwen-compatible-client";

export const GET_CURRENT_TIME_TOOL: ToolDefinition = {
  type: "function",
  function: {
    name: "get_current_time",
    description: "获取当前日期和时间。用于设置任务的截止日期时参考。返回 ISO 格式时间戳和中文日期。",
    parameters: { type: "object", properties: {} },
  },
};

export function buildGetCurrentTimeHandler(): ToolHandler {
  return async () => {
    const now = new Date();
    const iso = now.toISOString();
    const cn = `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日 ${now.getHours()}:${String(now.getMinutes()).padStart(2, "0")}`;
    const weekday = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][now.getDay()];
    return { iso, cn, weekday, timestamp: now.getTime() };
  };
}
