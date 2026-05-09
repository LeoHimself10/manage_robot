import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

export interface EmployeeProfileRecord {
  userId: string;
  displayName: string;
  department: string;
  role: string;
  level?: string;
  managerUserId?: string;
  location?: string;
  selfProfile: {
    skillTags: string[];
    strengths: string[];
    boundaries: string[];
    cases: Array<{
      taskType: string;
      contribution: string;
      deliverable: string;
      outcome: string;
    }>;
    tools: string[];
    availability: {
      capacityHint?: string;
      emergencyOk?: boolean;
      rejectedTaskTypes?: string[];
    };
  };
}

export function createEmployeeProfileRepo(profileDir: string) {
  return {
    list(): EmployeeProfileRecord[] {
      const names = readdirSync(profileDir).filter((f) => f.endsWith(".json"));
      return names.map(
        (n) => JSON.parse(readFileSync(join(profileDir, n), "utf8")) as EmployeeProfileRecord,
      );
    },
    get(userId: string): EmployeeProfileRecord | undefined {
      try {
        return JSON.parse(
          readFileSync(join(profileDir, `${userId}.json`), "utf8"),
        ) as EmployeeProfileRecord;
      } catch {
        return undefined;
      }
    },
  };
}
