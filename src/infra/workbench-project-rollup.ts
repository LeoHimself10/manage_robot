import {
  computeSubtaskBreakdown,
  deriveManagerAttentionLabel,
  type SubtaskAttentionInput,
  type SubtaskBreakdown,
} from "../web/workbench-attention";
import { UNASSIGNED_PROJECT_BUCKET, type WorkbenchProjectRow } from "./workbench-project-types";
import type { WorkbenchTaskRow } from "./workbench-formal-task-store";

export type ProjectRollupCard = {
  projectId: string;
  name: string;
  description?: string;
  status: "active" | "archived" | "unassigned";
  taskCount: number;
  breakdown: SubtaskBreakdown;
  attentionLabel: string;
  attentionBucket: string;
  headline: string;
  latestUpdatedAt?: string;
};

export type ProjectRollupInput = {
  projects: WorkbenchProjectRow[];
  tasks: Array<
    WorkbenchTaskRow & {
      subtasksCount: number;
      blockedCount: number;
    }
  >;
  getTaskAttention: (task: WorkbenchTaskRow) => {
    subtaskInputs: SubtaskAttentionInput[];
    attentionLabel: string;
    attentionBucket: string;
    attentionHint?: string;
  };
};

function mergeBreakdown(a: SubtaskBreakdown, b: SubtaskBreakdown): SubtaskBreakdown {
  return {
    needsManager: a.needsManager + b.needsManager,
    waitingAccept: a.waitingAccept + b.waitingAccept,
    inProgress: a.inProgress + b.inProgress,
    blocked: a.blocked + b.blocked,
    done: a.done + b.done,
    rejected: a.rejected + b.rejected,
    stopped: a.stopped + b.stopped,
  };
}

function buildHeadline(
  name: string,
  breakdown: SubtaskBreakdown,
  attentionLabel: string,
): string {
  const parts: string[] = [];
  if (breakdown.blocked > 0) parts.push(`${breakdown.blocked} 条阻塞`);
  if (breakdown.needsManager > 0) parts.push(`${breakdown.needsManager} 条待您处理`);
  if (parts.length === 0 && breakdown.inProgress > 0) parts.push(`${breakdown.inProgress} 条执行中`);
  if (parts.length === 0 && breakdown.waitingAccept > 0) parts.push(`${breakdown.waitingAccept} 条待承接`);
  if (parts.length === 0) return `${name}：${attentionLabel}`;
  return `${name}：${parts.join(" · ")}`;
}

export function buildProjectRollupCards(input: ProjectRollupInput): ProjectRollupCard[] {
  const byProject = new Map<string, ProjectRollupCard>();
  for (const p of input.projects) {
    byProject.set(p.projectId, {
      projectId: p.projectId,
      name: p.name,
      description: p.description,
      status: p.status,
      taskCount: 0,
      breakdown: {
        needsManager: 0,
        waitingAccept: 0,
        inProgress: 0,
        blocked: 0,
        done: 0,
        rejected: 0,
        stopped: 0,
      },
      attentionLabel: "已完成",
      attentionBucket: "done",
      headline: `${p.name}：暂无任务`,
    });
  }

  const unassigned: ProjectRollupCard = {
    projectId: UNASSIGNED_PROJECT_BUCKET,
    name: "未归类",
    status: "unassigned",
    taskCount: 0,
    breakdown: {
      needsManager: 0,
      waitingAccept: 0,
      inProgress: 0,
      blocked: 0,
      done: 0,
      rejected: 0,
      stopped: 0,
    },
    attentionLabel: "已完成",
    attentionBucket: "done",
    headline: "未归类：暂无任务",
  };

  for (const task of input.tasks) {
    const attn = input.getTaskAttention(task);
    const breakdown = computeSubtaskBreakdown(attn.subtaskInputs);
    const pid = String((task as WorkbenchTaskRow & { projectId?: string }).projectId ?? "").trim();
    const card = pid ? byProject.get(pid) : unassigned;
    if (!card) continue;
    card.taskCount += 1;
    card.breakdown = mergeBreakdown(card.breakdown, breakdown);
    const rank = attentionRank(attn.attentionBucket);
    const curRank = attentionRank(card.attentionBucket);
    if (rank < curRank || !card.latestUpdatedAt) {
      card.attentionLabel = attn.attentionLabel;
      card.attentionBucket = attn.attentionBucket;
    }
    const tu = task.updatedAt || task.publishedAt;
    if (!card.latestUpdatedAt || tu > card.latestUpdatedAt) {
      card.latestUpdatedAt = tu;
    }
  }

  const cards: ProjectRollupCard[] = [];
  for (const p of input.projects) {
    const c = byProject.get(p.projectId);
    if (!c) continue;
    c.headline = buildHeadline(c.name, c.breakdown, c.attentionLabel);
    cards.push(c);
  }
  if (unassigned.taskCount > 0) {
    unassigned.headline = buildHeadline(unassigned.name, unassigned.breakdown, unassigned.attentionLabel);
    cards.push(unassigned);
  }
  cards.sort((a, b) => {
    const ra = attentionRank(a.attentionBucket);
    const rb = attentionRank(b.attentionBucket);
    if (ra !== rb) return ra - rb;
    return String(b.latestUpdatedAt ?? "").localeCompare(String(a.latestUpdatedAt ?? ""));
  });
  return cards;
}

function attentionRank(bucket: string): number {
  if (bucket === "needs_manager") return 0;
  if (bucket === "blocked") return 1;
  if (bucket === "waiting_employee") return 2;
  if (bucket === "employee_running") return 3;
  if (bucket === "done") return 4;
  return 5;
}
