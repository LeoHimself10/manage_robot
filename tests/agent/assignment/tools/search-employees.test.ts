import { describe, expect, it } from "vitest";
import type { EmployeeProfileRecord } from "../../../../src/integrations/repos/employee-profile-repo";
import {
  buildSearchEmployeesHandler,
  compressProfile,
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
  makeProfile({ userId: "emp_qa_002", department: "测试部", role: "Technician", selfProfile: { skillTags: ["QC 7 tools"], strengths: ["inspection"], boundaries: [], cases: [], tools: [], availability: {} } }),
  makeProfile({ userId: "emp_rd_001", department: "研发部", role: "Manager", selfProfile: { skillTags: ["CAD", "Python"], strengths: ["design"], boundaries: [], cases: [], tools: [], availability: {} } }),
  makeProfile({ userId: "emp_rd_002", department: "软件部", role: "Engineer", selfProfile: { skillTags: ["Python", "DOE"], strengths: ["coding"], boundaries: [], cases: [], tools: [], availability: {} } }),
  makeProfile({ userId: "emp_qa_003", department: "供应商质量", role: "Engineer", selfProfile: { skillTags: ["8D", "CAPA"], strengths: ["supplier audit"], boundaries: [], cases: [], tools: [], availability: {} } }),
];

describe("SEARCH_EMPLOYEES_TOOL", () => {
  it("has correct tool definition structure", () => {
    expect(SEARCH_EMPLOYEES_TOOL.type).toBe("function");
    expect(SEARCH_EMPLOYEES_TOOL.function.name).toBe("search_employees");
    expect(SEARCH_EMPLOYEES_TOOL.function.parameters).toHaveProperty("properties");
    expect(SEARCH_EMPLOYEES_TOOL.function.parameters.properties).toHaveProperty("domain");
    expect(SEARCH_EMPLOYEES_TOOL.function.parameters.properties).toHaveProperty("skills");
  });
});

describe("compressProfile", () => {
  it("includes outcome in case descriptions", () => {
    const compressed = compressProfile(PROFILES[0]);
    expect(compressed).toContain("outcome=closed");
  });

  it("includes userId and displayName", () => {
    const compressed = compressProfile(PROFILES[0]);
    expect(compressed).toContain("userId: emp_qa_001");
    expect(compressed).toContain("displayName: Test User");
  });

  it("includes skillTags and strengths", () => {
    const compressed = compressProfile(PROFILES[0]);
    expect(compressed).toContain("skillTags:");
    expect(compressed).toContain("strengths:");
  });

  it("handles profile with empty cases", () => {
    const compressed = compressProfile(PROFILES[1]);
    expect(compressed).not.toContain("cases:");
  });
});

describe("buildSearchEmployeesHandler", () => {
  const repo = { list: () => PROFILES };
  const handler = buildSearchEmployeesHandler(repo);

  it("returns all candidates with empty args", () => {
    const result = handler({}) as {
      candidates: string[];
      truncated: boolean;
      total: number;
    };
    expect(result.total).toBe(5);
    expect(result.truncated).toBe(false);
    expect(result.candidates).toHaveLength(5);
  });

  it("filters by domain QUALITY", () => {
    const result = handler({ domain: "QUALITY" }) as {
      candidates: string[];
      truncated: boolean;
      total: number;
    };
    expect(result.total).toBe(3);
  });

  it("filters by domain RD", () => {
    const result = handler({ domain: "RD" }) as {
      candidates: string[];
      truncated: boolean;
      total: number;
    };
    expect(result.total).toBe(2);
  });

  it("filters by skills (any-of)", () => {
    const result = handler({ skills: ["8D"] }) as {
      candidates: string[];
      total: number;
    };
    // emp_qa_001 and emp_qa_003 have 8D
    expect(result.total).toBe(2);
  });

  it("filters by skills combined with domain", () => {
    const result = handler({ domain: "QUALITY", skills: ["8D"] }) as {
      candidates: string[];
      total: number;
    };
    expect(result.total).toBe(2);
  });

  it("filters by exact department", () => {
    const result = handler({ department: "软件部" }) as {
      candidates: string[];
      total: number;
    };
    expect(result.total).toBe(1);
    expect(result.candidates[0]).toContain("emp_rd_002");
  });

  it("filters by role", () => {
    const result = handler({ role: "Technician" }) as {
      candidates: string[];
      total: number;
    };
    expect(result.total).toBe(1);
  });

  it("sets truncated flag when over limit", () => {
    const manyProfiles: EmployeeProfileRecord[] = [];
    for (let i = 0; i < 35; i++) {
      manyProfiles.push(
        makeProfile({ userId: `emp_${i}`, department: "质量部", role: "Engineer" }),
      );
    }
    const bigRepo = { list: () => manyProfiles };
    const bigHandler = buildSearchEmployeesHandler(bigRepo);
    const result = bigHandler({ domain: "QUALITY" }) as {
      candidates: string[];
      truncated: boolean;
      total: number;
    };
    expect(result.total).toBe(35);
    expect(result.truncated).toBe(true);
    expect(result.candidates).toHaveLength(30);
  });

  it("returns empty candidates when no match", () => {
    const result = handler({ role: "NonexistentRole" }) as {
      candidates: string[];
      total: number;
    };
    expect(result.total).toBe(0);
    expect(result.candidates).toHaveLength(0);
  });
});
