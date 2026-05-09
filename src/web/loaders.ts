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
