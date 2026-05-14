import { describe, expect, it } from "vitest";
import type { EmployeeProfileRecord } from "../../../../src/integrations/repos/employee-profile-repo";
import {
  buildGetEmployeeDetailsHandler,
  buildSearchEmployeesHandler,
  compressProfile,
  compressProfileBrief,
  compressProfileFull,
  SEARCH_EMPLOYEES_TOOL,
} from "../../../../src/agent/assignment/tools/search-employees";

function makeProfile(overrides: Partial<EmployeeProfileRecord> & { userId: string }): EmployeeProfileRecord {
  return {
    displayName: "Test User",
    department: "质量部",
    role: "Engineer",
    selfProfile: {
      skillTags: ["8D", "FMEA"],
      strengths: ["root cause analysis"],
      boundaries: [],
      cases: [
        { taskType: "quality_incident", contribution: "lead", deliverable: "report", outcome: "closed" },
      ],
      tools: ["Excel"],
      availability: {
        capacityHint: "80%",
        emergencyOk: true,
        rejectedTaskTypes: [],
      },
    },
    ...overrides,
  };
}

const PROFILES: EmployeeProfileRecord[] = [
  makeProfile({ userId: "emp_qa_001", department: "质量部", role: "Engineer" }),
  makeProfile({
    userId: "emp_qa_002",
    department: "测试部",
    role: "Technician",
    selfProfile: {
      skillTags: ["QC 7 tools"],
      strengths: ["inspection"],
      boundaries: [],
      cases: [],
      tools: [],
      availability: {},
    },
  }),
  makeProfile({
    userId: "emp_rd_001",
    department: "研发部",
    role: "Manager",
    selfProfile: { skillTags: ["CAD", "Python"], strengths: ["design"], boundaries: [], cases: [], tools: [], availability: {} },
  }),
  makeProfile({
    userId: "emp_rd_002",
    department: "软件部",
    role: "Engineer",
    selfProfile: { skillTags: ["Python", "DOE"], strengths: ["coding"], boundaries: [], cases: [], tools: [], availability: {} },
  }),
  makeProfile({
    userId: "emp_qa_003",
    department: "供应商质量",
    role: "Engineer",
    selfProfile: { skillTags: ["8D", "CAPA"], strengths: ["supplier audit"], boundaries: [], cases: [], tools: [], availability: {} },
  }),
];

function repoWithGet(list: EmployeeProfileRecord[]) {
  return {
    list: () => list,
    get: (userId: string) => list.find((p) => p.userId === userId),
  };
}

describe("SEARCH_EMPLOYEES_TOOL", () => {
  it("has correct tool definition structure", () => {
    expect(SEARCH_EMPLOYEES_TOOL.type).toBe("function");
    expect(SEARCH_EMPLOYEES_TOOL.function.name).toBe("search_employees");
    expect(SEARCH_EMPLOYEES_TOOL.function.parameters).toHaveProperty("properties");
    expect(SEARCH_EMPLOYEES_TOOL.function.parameters.properties).toHaveProperty("domain");
    expect(SEARCH_EMPLOYEES_TOOL.function.parameters.properties).toHaveProperty("name");
  });
});

describe("compressProfileFull / compressProfile", () => {
  it("includes outcome in case descriptions", () => {
    const compressed = compressProfileFull(PROFILES[0]);
    expect(compressed).toContain("outcome=closed");
  });

  it("includes userId and displayName", () => {
    const compressed = compressProfileFull(PROFILES[0]);
    expect(compressed).toContain("userId: emp_qa_001");
    expect(compressed).toContain("displayName: Test User");
  });

  it("includes background when present", () => {
    const p = makeProfile({
      userId: "u_bg",
      selfProfile: {
        ...PROFILES[0].selfProfile,
        background: "Former QE lead in automotive.",
      },
    });
    expect(compressProfile(p)).toContain("background:");
    expect(compressProfile(p)).toContain("Former QE lead");
  });

  it("handles profile with empty cases", () => {
    const compressed = compressProfileFull(PROFILES[1]);
    expect(compressed).not.toContain("cases:\n");
  });
});

describe("compressProfileBrief", () => {
  it("marks local flag", () => {
    const line = compressProfileBrief(PROFILES[0], true);
    expect(line).toContain("local=true");
    const line2 = compressProfileBrief(PROFILES[0], false);
    expect(line2).toContain("local=false");
  });
});

describe("buildGetEmployeeDetailsHandler", () => {
  it("returns compressed blocks per userId", () => {
    const handler = buildGetEmployeeDetailsHandler(repoWithGet(PROFILES));
    const out = handler({ userIds: ["emp_qa_001", "missing"] }) as { employees: string[] };
    expect(out.employees).toHaveLength(2);
    expect(out.employees[0]).toContain("emp_qa_001");
    expect(out.employees[1]).toContain("missing");
  });
});

describe("buildSearchEmployeesHandler", () => {
  const repo = repoWithGet(PROFILES);
  const handler = buildSearchEmployeesHandler(repo);

  it("returns default list with soft hints only (no domain hard filter)", () => {
    const result = handler({ domain: "QUALITY" }) as {
      candidates: string[];
      truncated: boolean;
      total: number;
      note?: string;
    };
    expect(result.total).toBe(5);
    expect(result.candidates).toHaveLength(5);
    expect(result.truncated).toBe(false);
    expect(result.note).toContain("domainHint=QUALITY");
    expect(result.note).toContain("soft_hints_only_no_hard_filter");
  });

  it("includes skills and department hints in note without reducing total", () => {
    const result = handler({
      skills: ["8D"],
      department: "软件部",
      role: "Technician",
    }) as { total: number; note?: string };
    expect(result.total).toBe(5);
    expect(result.note).toContain("skillsHint=8D");
    expect(result.note).toContain("departmentHint=软件部");
    expect(result.note).toContain("roleHint=Technician");
  });

  it("sets truncated when over default cap (default = 25)", () => {
    const manyProfiles: EmployeeProfileRecord[] = [];
    for (let i = 0; i < 120; i++) {
      manyProfiles.push(makeProfile({ userId: `emp_pad_${String(i).padStart(3, "0")}`, department: "质量部", role: "Engineer" }));
    }
    const bigHandler = buildSearchEmployeesHandler(repoWithGet(manyProfiles));
    const result = bigHandler({}) as {
      candidates: string[];
      truncated: boolean;
      total: number;
    };
    expect(result.total).toBe(120);
    expect(result.truncated).toBe(true);
    expect(result.candidates.length).toBeLessThanOrEqual(25);
  });

  it("returns search_employees_quota_exhausted after 3 calls on the same handler", () => {
    const localHandler = buildSearchEmployeesHandler(repoWithGet(PROFILES));
    const r1 = localHandler({}) as Record<string, unknown>;
    const r2 = localHandler({}) as Record<string, unknown>;
    const r3 = localHandler({}) as Record<string, unknown>;
    const r4 = localHandler({}) as Record<string, unknown>;
    expect(r1.ok).toBeUndefined();
    expect(r2.ok).toBeUndefined();
    expect(r3.ok).toBeUndefined();
    expect(r4.ok).toBe(false);
    expect(r4.reason).toBe("search_employees_quota_exhausted");
    expect(r4.callCount).toBe(4);
    expect(r4.quota).toBe(3);
    expect(String(r4.hint)).toContain("已达上限");
  });

  it("returns only candidate pool members when pool is active and no name", () => {
    const handler = buildSearchEmployeesHandler(repo, {
      candidatePool: () => [
        { userId: "emp_qa_001", displayName: "Test User", fileNotes: "QA 主力" },
        { userId: "emp_rd_001", displayName: "Test User" },
      ],
    });
    const result = handler({}) as {
      candidates: string[];
      total: number;
      poolConstrained?: boolean;
      note?: string;
    };
    expect(result.poolConstrained).toBe(true);
    expect(result.total).toBe(2);
    expect(result.candidates).toHaveLength(2);
    expect(result.candidates[0]).toContain("emp_qa_001");
    expect(result.candidates[0]).toContain("fileNotes: QA 主力");
    // 不在池里的 emp_qa_002 / emp_rd_002 / emp_qa_003 都不应出现
    const joined = result.candidates.join("\n");
    expect(joined).not.toContain("emp_qa_002");
    expect(joined).not.toContain("emp_rd_002");
    expect(joined).not.toContain("emp_qa_003");
    expect(result.note).toContain("candidate_pool_active");
  });

  it("ignores candidate pool when empty (falls back to full directory)", () => {
    const handler = buildSearchEmployeesHandler(repo, {
      candidatePool: () => [],
    });
    const result = handler({}) as {
      total: number;
      poolConstrained?: boolean;
    };
    expect(result.poolConstrained).toBeUndefined();
    expect(result.total).toBe(5);
  });

  it("uses each handler instance with independent counter", () => {
    const h1 = buildSearchEmployeesHandler(repoWithGet(PROFILES));
    const h2 = buildSearchEmployeesHandler(repoWithGet(PROFILES));
    h1({});
    h1({});
    h1({});
    h1({});
    const exhausted = h1({}) as Record<string, unknown>;
    expect(exhausted.ok).toBe(false);
    expect(exhausted.reason).toBe("search_employees_quota_exhausted");
    const fresh = h2({}) as Record<string, unknown>;
    expect(fresh.ok).toBeUndefined();
    expect(fresh.total).toBe(5);
  });
});
