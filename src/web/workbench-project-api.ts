import { createWorkbenchFormalTaskStore } from "../infra/workbench-formal-task-store";
import {
  buildProjectRollupCards,
  type ProjectRollupCard,
} from "../infra/workbench-project-rollup";
import {
  UNASSIGNED_PROJECT_BUCKET,
  type WorkbenchProjectRow,
} from "../infra/workbench-project-types";
import type { WorkbenchTaskRow } from "../infra/workbench-formal-task-store";
import {
  deriveManagerAttentionLabel,
  type SubtaskAttentionInput,
} from "./workbench-attention";
import { createPeopleDirectoryStore } from "../infra/people-directory-store";

function withPeopleDirectoryStore<T>(
  fn: (store: ReturnType<typeof createPeopleDirectoryStore>) => T,
): T {
  const store = createPeopleDirectoryStore();
  try {
    return fn(store);
  } finally {
    store.close();
  }
}

export type ManagerTaskApiRow = ReturnType<typeof enrichOneManagerTask>;

function getFormalTaskStore() {
  return createWorkbenchFormalTaskStore();
}

function buildTaskAttentionInputs(
  store: ReturnType<typeof createWorkbenchFormalTaskStore>,
  taskNo: string,
): SubtaskAttentionInput[] {
  const detail = store.getTaskDetail(taskNo);
  if (!detail) return [];
  const subInputs: SubtaskAttentionInput[] = [];
  for (const s of detail.subtasks) {
    subInputs.push({
      status: String(s.status ?? ""),
      openDeclineKind: store.getSubtaskOpenDeclineKind(s.subtaskId),
    });
  }
  return subInputs;
}

function enrichOneManagerTask(
  managerUserId: string,
  t: WorkbenchTaskRow & { subtasksCount: number; blockedCount: number },
  projectNameById: Map<string, string>,
) {
  const store = getFormalTaskStore();
  const names = new Set<string>();
  const subInputs = buildTaskAttentionInputs(store, t.taskNo);
  const detail = store.getTaskDetail(t.taskNo);
  if (detail) {
    for (const s of detail.subtasks) {
      const picked = withPeopleDirectoryStore((st) =>
        st.getContact(s.assigneeUserId)?.name?.trim(),
      );
      if (picked) names.add(picked);
    }
  }
  const attn = deriveManagerAttentionLabel(subInputs);
  const pid = String(t.projectId ?? "").trim();
  return {
    ...t,
    statusLabel: attn.attentionLabel,
    attentionLabel: attn.attentionLabel,
    attentionBucket: attn.attentionBucket,
    attentionHint: attn.attentionHint,
    subtaskBreakdown: attn.breakdown,
    openManagerSubtaskCount: attn.openManagerSubtaskCount,
    assigneeSummary: names.size ? [...names].join("、") : "—",
    triageOpenSubtaskCount: attn.openManagerSubtaskCount,
    projectName: pid ? projectNameById.get(pid) ?? "" : "",
  };
}

export function enrichManagerTasksForApi(
  managerUserId: string,
  filter?: { projectId?: string },
): ManagerTaskApiRow[] {
  const store = getFormalTaskStore();
  const projects = store.listProjectsForOwner(managerUserId);
  const projectNameById = new Map(projects.map((p) => [p.projectId, p.name]));
  const pid = String(filter?.projectId ?? "").trim();
  const tasks = store.listManagerTasks(managerUserId, pid ? { projectId: pid } : undefined);
  return tasks.map((t) => enrichOneManagerTask(managerUserId, t, projectNameById));
}

export function buildManagerProjectsListResponse(managerUserId: string): {
  projects: WorkbenchProjectRow[];
  cards: ProjectRollupCard[];
} {
  const store = getFormalTaskStore();
  const projects = store.listProjectsForOwner(managerUserId);
  const tasks = store.listManagerTasks(managerUserId);
  const cards = buildProjectRollupCards({
    projects,
    tasks,
    getTaskAttention: (task) => {
      const subInputs = buildTaskAttentionInputs(store, task.taskNo);
      const attn = deriveManagerAttentionLabel(subInputs);
      return {
        subtaskInputs: subInputs,
        attentionLabel: attn.attentionLabel,
        attentionBucket: attn.attentionBucket,
        attentionHint: attn.attentionHint,
      };
    },
  });
  return { projects, cards };
}

export function buildManagerProjectDetailResponse(
  managerUserId: string,
  projectId: string,
): { project: WorkbenchProjectRow; tasks: ManagerTaskApiRow[] } | null {
  const store = getFormalTaskStore();
  const pid = projectId.trim();
  if (pid === UNASSIGNED_PROJECT_BUCKET) {
    const tasks = enrichManagerTasksForApi(managerUserId, { projectId: UNASSIGNED_PROJECT_BUCKET });
    return {
      project: {
        projectId: UNASSIGNED_PROJECT_BUCKET,
        name: "未归类",
        ownerUserId: managerUserId,
        status: "active" as const,
        aliases: [],
        createdAt: "",
        updatedAt: "",
      },
      tasks,
    };
  }
  const project = store.getProject(pid, managerUserId);
  if (!project) return null;
  const tasks = enrichManagerTasksForApi(managerUserId, { projectId: pid });
  return { project, tasks };
}
