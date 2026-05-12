import { readFileSync } from "fs";
import { createPeopleDirectoryStore } from "../src/infra/people-directory-store";

const fixturePath = process.env.EMPLOYEE_FIXTURE_SOURCE || "fixtures/employees-seed.json";

function main() {
  try {
    const raw = JSON.parse(readFileSync(fixturePath, "utf8")) as { profiles: unknown[] };
    const store = createPeopleDirectoryStore();
    for (const profile of raw.profiles) {
      const row = profile as Record<string, unknown>;
      const userId = String(row.userId ?? "").trim();
      if (!userId) {
        console.warn("[seed] skipping entry without userId");
        continue;
      }
      const department = String(row.department ?? "未分配部门").trim() || "未分配部门";
      const role = String(row.role ?? "Employee").trim() || "Employee";
      const displayName = String(row.displayName ?? userId).trim() || userId;
      const selfProfile = (row.selfProfile ?? {}) as Record<string, unknown>;
      store.upsertContact({
        userId,
        name: displayName,
        departmentIds: [department],
        departmentNames: [department],
        position: role,
        active: true,
        isAdmin: false,
        isBoss: false,
        isSenior: false,
        rawJson: row,
      });
      store.upsertProfile({
        userId,
        skillTags: Array.isArray(selfProfile.skillTags) ? selfProfile.skillTags.map((x) => String(x)) : [],
        strengths: Array.isArray(selfProfile.strengths) ? selfProfile.strengths.map((x) => String(x)) : [],
        boundaries: Array.isArray(selfProfile.boundaries) ? selfProfile.boundaries.map((x) => String(x)) : [],
        cases: Array.isArray(selfProfile.cases)
          ? selfProfile.cases.map((item) => {
              const c = item as Record<string, unknown>;
              return {
                taskType: String(c.taskType ?? "unknown"),
                contribution: typeof c.contribution === "string" ? c.contribution : undefined,
                deliverable: typeof c.deliverable === "string" ? c.deliverable : undefined,
                outcome: String(c.outcome ?? "unknown"),
              };
            })
          : [],
        tools: Array.isArray(selfProfile.tools) ? selfProfile.tools.map((x) => String(x)) : [],
        availability:
          selfProfile.availability && typeof selfProfile.availability === "object"
            ? (selfProfile.availability as {
                capacityHint?: string;
                emergencyOk?: boolean;
                rejectedTaskTypes?: string[];
              })
            : {},
        background: String(row.location ?? ""),
        source: "seed_script",
      });
      store.appendProfileEvent({
        userId,
        eventType: "seed_imported",
        actorUserId: "seed-script",
        payload: { fixturePath },
      });
      console.log(`[seed] upserted ${userId} to sqlite`);
    }
  } catch (err) {
    console.error("[seed] failed:", err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

main();
