/**
 * 粗粒度判断本轮是否处于「分配/搜人」阶段（C-2）。
 * 追问（A）、出草案（B）阶段不应暴露 search_employees / get_employee_details。
 */

const ASSIGNMENT_INTENT =
  /分配|指派|点将|派给|人员名单|花名册|按.{0,6}表|谁来做|负责人|匹配.{0,4}人|set_candidate|候选池/i;

const ROSTER_UPLOAD_HINT = /uploaded:roster|pendingRoster/i;

export interface EmployeeSearchExposureInput {
  userMessage: string;
  hasLatestDraft: boolean;
  hasPendingRoster: boolean;
  hasCandidatePool: boolean;
}

/** 是否向模型暴露搜人相关工具（未暴露时 handler 也不会注册） */
export function shouldExposeEmployeeSearchTools(
  input: EmployeeSearchExposureInput,
): boolean {
  const text = String(input.userMessage ?? "").replace(/\s+/g, " ").trim();
  if (!text) return false;

  if (input.hasPendingRoster) return true;
  if (ASSIGNMENT_INTENT.test(text)) return true;

  // 已有草案且用户明确要分配/确认负责人
  if (input.hasLatestDraft && /确认.{0,8}(分配|负责人|名单)|分配吧|按名单/i.test(text)) {
    return true;
  }

  // 仅有旧 candidatePool、但用户只是在补充背景/截止时间 → 不暴露
  if (input.hasCandidatePool && !input.hasLatestDraft) {
    return false;
  }

  return false;
}

export function shouldInjectCandidatePoolMemoryHint(
  input: EmployeeSearchExposureInput,
): boolean {
  return input.hasCandidatePool && shouldExposeEmployeeSearchTools(input);
}
