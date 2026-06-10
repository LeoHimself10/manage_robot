import { describe, expect, it } from "vitest";

import {
  groupOrgDigestsByProject,
  listProjectGroupAssignmentsFromConfig,
  resolveProjectGroup,
} from "../../../src/agent/daily-report-digest/daily-report-project-groups";
import type { OrgDigest } from "../../../src/agent/daily-report-digest/daily-report-build";

describe("daily-report-project-groups", () => {
  it("resolves default groups by name when not configured", () => {
    expect(resolveProjectGroup({ userid: "u1", name: "崔枭" })).toBe("brain");
    expect(resolveProjectGroup({ userid: "u2", name: "贾三祥" })).toBe("brain");
    expect(resolveProjectGroup({ userid: "u3", name: "薛婷" })).toBe("ops");
    expect(resolveProjectGroup({ userid: "u4", name: "张三" })).toBe("intracranial");
  });

  it("prefers configured projectGroup over name defaults", () => {
    expect(
      resolveProjectGroup({ userid: "u1", name: "薛婷", configured: "brain" }),
    ).toBe("brain");
  });

  it("groups org digests into three project buckets", () => {
    const orgDigests: OrgDigest[] = [
      {
        label: "微光",
        submitted: [
          { userid: "u1", name: "崔枭", reports: [] },
          { userid: "u2", name: "李强", reports: [] },
        ],
        missing: [{ userid: "u3", name: "薛婷" }],
        errors: [],
      },
    ];
    const assignments = listProjectGroupAssignmentsFromConfig([
      {
        label: "微光",
        employees: [
          { userid: "u1", name: "崔枭" },
          { userid: "u2", name: "李强" },
          { userid: "u3", name: "薛婷" },
        ],
      },
    ]);
    const grouped = groupOrgDigestsByProject(orgDigests, assignments);
    expect(grouped.map((g) => g.id)).toEqual(["intracranial", "brain", "ops"]);
    const brain = grouped.find((g) => g.id === "brain")!;
    expect(brain.orgs[0]!.submitted[0]!.name).toBe("崔枭");
    const ops = grouped.find((g) => g.id === "ops")!;
    expect(ops.orgs[0]!.missing[0]!.name).toBe("薛婷");
    const intra = grouped.find((g) => g.id === "intracranial")!;
    expect(intra.orgs[0]!.submitted[0]!.name).toBe("李强");
  });
});
