import type { ToolDefinition, ToolHandler } from "../../demo/qwen-compatible-client";
import type { EmployeeProfileRecord } from "../../../integrations/repos/employee-profile-repo";

export interface SearchEmployeesArgs {
  domain?: string;
  skills?: string[];
  department?: string;
  role?: string;
}

export interface SearchEmployeesResult {
  candidates: string[];
  truncated: boolean;
  total: number;
  note?: string;
}

const DOMAIN_DEPARTMENT_MAP: Record<string, string[]> = {
  QUALITY: ["质量部", "测试部", "供应商质量"],
  RD: ["研发部", "硬件部", "软件部", "结构部"],
};

export const SEARCH_EMPLOYEES_TOOL: ToolDefinition = {
  type: "function",
  function: {
    name: "search_employees",
    description: "根据领域、技能、部门、角色筛选员工档案，返回压缩画像列表。必须先调用此工具获取候选人信息再生成分配建议。",
    parameters: {
      type: "object",
      properties: {
        domain: {
          type: "string",
          description: "任务领域：QUALITY（质量部/测试部/供应商质量）或 RD（研发部/硬件部/软件部/结构部）",
          enum: ["QUALITY", "RD"],
        },
        skills: {
          type: "array",
          items: { type: "string" },
          description: "技能标签列表（如 8D、FMEA、QC 7 tools、CAPA、PFMEA、SPC、CAD、Python、DOE）",
        },
        department: {
          type: "string",
          description: "精确部门名称筛选",
        },
        role: {
          type: "string",
          description: "角色筛选（如 Engineer、Manager、Technician）",
        },
      },
      required: [],
    },
  },
};

const MAX_CANDIDATES = 30;

export function compressProfile(p: EmployeeProfileRecord): string {
  const lines: string[] = [];

  lines.push(`userId: ${p.userId}`);
  lines.push(`displayName: ${p.displayName}`);
  lines.push(`department: ${p.department}`);
  lines.push(`role: ${p.role}`);
  if (p.level) lines.push(`level: ${p.level}`);

  const tags = p.selfProfile.skillTags;
  if (tags.length > 0) lines.push(`skillTags: [${tags.join(", ")}]`);

  const strengths = p.selfProfile.strengths;
  if (strengths.length > 0) lines.push(`strengths: [${strengths.join(", ")}]`);

  const boundaries = p.selfProfile.boundaries;
  if (boundaries.length > 0) lines.push(`boundaries: [${boundaries.join(", ")}]`);

  const cases = p.selfProfile.cases;
  if (cases.length > 0) {
    const caseLines = cases.map(
      (c) => `  - taskType=${c.taskType}, outcome=${c.outcome}`,
    );
    lines.push(`cases:\n${caseLines.join("\n")}`);
  }

  const tools = p.selfProfile.tools;
  if (tools.length > 0) lines.push(`tools: [${tools.join(", ")}]`);

  const avail = p.selfProfile.availability;
  if (avail.capacityHint) lines.push(`capacityHint: ${avail.capacityHint}`);
  if (avail.emergencyOk !== undefined) lines.push(`emergencyOk: ${avail.emergencyOk}`);
  if (avail.rejectedTaskTypes && avail.rejectedTaskTypes.length > 0) {
    lines.push(`rejectedTaskTypes: [${avail.rejectedTaskTypes.join(", ")}]`);
  }
  if (p.taskHistory) {
    lines.push(
      `taskHistory: assigned=${p.taskHistory.totalAssigned}, done=${p.taskHistory.doneCount}, blocked=${p.taskHistory.blockedCount}, rejected=${p.taskHistory.rejectedCount}, accepted=${p.taskHistory.acceptedCount}, inProgress=${p.taskHistory.inProgressCount}`,
    );
  }

  return lines.join("\n");
}

export function buildSearchEmployeesHandler(
  repo: { list(): EmployeeProfileRecord[] },
): ToolHandler {
  return (args: Record<string, unknown>): SearchEmployeesResult => {
    const { domain, skills, department, role } = args as unknown as SearchEmployeesArgs;

    const baseAll = repo.list();
    let all = [...baseAll];

    // Filter by domain → department mapping
    if (domain && DOMAIN_DEPARTMENT_MAP[domain]) {
      const allowedDepts = new Set(DOMAIN_DEPARTMENT_MAP[domain]);
      all = all.filter((p) => allowedDepts.has(p.department));
    }

    // Filter by exact department
    if (department) {
      all = all.filter((p) => p.department === department);
    }

    // Filter by skills (any-of match)
    let fallbackNote: string | undefined;
    if (skills && skills.length > 0) {
      const skillSet = new Set(skills.map((s) => s.toLowerCase()));
      const skillFiltered = all.filter((p) =>
        p.selfProfile.skillTags.some((tag) => skillSet.has(tag.toLowerCase())),
      );
      if (skillFiltered.length === 0) {
        fallbackNote = "能力画像暂缺，已按部门/岗位/历史任务降级推荐";
      } else {
        all = skillFiltered;
      }
    }

    // Filter by role
    if (role) {
      const roleLower = role.toLowerCase();
      all = all.filter((p) => p.role.toLowerCase().includes(roleLower));
    }

    const total = all.length;
    const truncated = total > MAX_CANDIDATES;
    const candidates = all.slice(0, MAX_CANDIDATES).map(compressProfile);

    return { candidates, truncated, total, note: fallbackNote };
  };
}
