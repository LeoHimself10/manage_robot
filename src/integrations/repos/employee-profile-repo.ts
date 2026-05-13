import { createPeopleDirectoryStore } from "../../infra/people-directory-store";

export interface EmployeeProfileRecord {
  userId: string;
  displayName: string;
  department: string;
  /** DingTalk department IDs (when contact synced) */
  departmentIds?: string[];
  /** Parallel names to departmentIds */
  departmentNames?: string[];
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
    /** Employee-authored narrative (when present in DB) */
    background?: string;
  };
  taskHistory?: {
    totalAssigned: number;
    doneCount: number;
    blockedCount: number;
    rejectedCount: number;
    acceptedCount: number;
    inProgressCount: number;
  };
}

export function createEmployeeProfileRepo(_profileDir?: string) {
  function toRecord(snapshot: ReturnType<ReturnType<typeof createPeopleDirectoryStore>["getEmployeeSnapshot"]>): EmployeeProfileRecord | undefined {
    if (!snapshot) return undefined;
    return {
      userId: snapshot.userId,
      displayName: snapshot.displayName || snapshot.userId,
      department: snapshot.department || "未分配部门",
      departmentIds: snapshot.departmentIds,
      departmentNames: snapshot.departmentNames,
      role: snapshot.role || "Employee",
      level: snapshot.level,
      managerUserId: snapshot.managerUserId,
      location: snapshot.location,
      selfProfile: {
        skillTags: snapshot.selfProfile.skillTags ?? [],
        strengths: snapshot.selfProfile.strengths ?? [],
        boundaries: snapshot.selfProfile.boundaries ?? [],
        cases: (snapshot.selfProfile.cases ?? []).map((item) => ({
          taskType: item.taskType,
          contribution: item.contribution ?? "",
          deliverable: item.deliverable ?? "",
          outcome: item.outcome,
        })),
        tools: snapshot.selfProfile.tools ?? [],
        availability: snapshot.selfProfile.availability ?? {},
        background: snapshot.selfProfile.background,
      },
      taskHistory: snapshot.taskHistory,
    };
  }

  return {
    list(): EmployeeProfileRecord[] {
      const peopleStore = createPeopleDirectoryStore();
      try {
        return peopleStore
          .listEmployeeSnapshots()
          .filter((snapshot) => snapshot.active)
          .map((snapshot) => toRecord(snapshot))
          .filter((snapshot): snapshot is EmployeeProfileRecord => Boolean(snapshot));
      } finally {
        peopleStore.close();
      }
    },
    get(userId: string): EmployeeProfileRecord | undefined {
      const peopleStore = createPeopleDirectoryStore();
      try {
        return toRecord(peopleStore.getEmployeeSnapshot(userId));
      } finally {
        peopleStore.close();
      }
    },
  };
}
