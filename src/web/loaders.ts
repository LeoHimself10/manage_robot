import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type { PlanSession } from "../infra/plan-session-store";
import {
  createAssignmentDraftRepo,
} from "../integrations/repos/assignment-draft-repo";
import {
  createEmployeeProfileRepo,
  type EmployeeProfileRecord,
} from "../integrations/repos/employee-profile-repo";

/**
 * Read a single assignment draft by planId.
 * Returns undefined when the draft file does not exist on disk.
 */
export function readAssignmentDraft(
  draftDir: string,
  planId: string,
): Record<string, unknown> | undefined {
  const repo = createAssignmentDraftRepo(draftDir);
  return repo.load(planId);
}

/**
 * List all employee profiles from the profiles directory.
 */
export function getEmployeeProfiles(
  profileDir: string,
): EmployeeProfileRecord[] {
  const repo = createEmployeeProfileRepo(profileDir);
  return repo.list();
}

/**
 * Read all persisted plan sessions from a directory.
 * Invalid or partially-written JSON files are skipped so one bad session does
 * not prevent the workbench from rendering the rest of the queue.
 */
export function listPlanSessions(sessionDir: string): PlanSession[] {
  let files: string[];
  try {
    files = readdirSync(sessionDir);
  } catch {
    return [];
  }

  return files
    .filter((file) => file.endsWith(".json"))
    .flatMap((file) => {
      try {
        const loaded = JSON.parse(
          readFileSync(join(sessionDir, file), "utf8"),
        ) as PlanSession;
        return [
          {
            ...loaded,
            knownFacts: Array.isArray(loaded.knownFacts) ? loaded.knownFacts : [],
            conversationHistory: Array.isArray(loaded.conversationHistory)
              ? loaded.conversationHistory
              : [],
            conversationSessions: Array.isArray(loaded.conversationSessions)
              ? loaded.conversationSessions
              : undefined,
          },
        ];
      } catch {
        return [];
      }
    });
}
