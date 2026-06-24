/** 微光 CTO 日报统计：仅三类研发模板参与统一日筛与分桶。 */
export const RD_DAILY_TEMPLATE_MATCHERS = [
  "研发中心日志",
  "研发管理者日志",
  "研发试用期日志",
] as const;

export function isRdDailyTemplate(templateName: string): boolean {
  const n = String(templateName ?? "").trim();
  if (!n) return false;
  return RD_DAILY_TEMPLATE_MATCHERS.some((m) => n.includes(m));
}
