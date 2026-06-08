/**
 * 员工迟交/延期绩效聚合（纯函数，只读）。
 *
 * 口径：
 * - 仅统计有可解析截止时间（due_at）的子任务（无截止无法判定迟交）。
 * - 迟交完成：status=DONE 且 completedAt > effectiveDue。
 * - 准时完成：status=DONE 且 completedAt <= effectiveDue（无 completedAt 时回退按未迟交处理并计入 unknownCompletion）。
 * - 当前逾期：status 非终结态（DONE/STOPPED）且 effectiveDue < asOf。
 * - **已停止（STOPPED）子任务不参与任何绩效统计**（与看板表格一致）。
 * - effectiveDue 用 parseDueAtMs（纯日期 YYYY-MM-DD = 北京时间当天 18:00）。
 *
 * 公正性说明：被改派过的子任务以 reassignedInvolved 标注，催办/逾期提醒计数按子任务归到当前负责人（近似）。
 */
import { parseDueAtMs } from "../reminders/due-at-parse";

const TERMINAL_STATUSES = new Set(["DONE", "STOPPED"]);
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface PerformanceSubtaskInput {
  subtaskId: string;
  assigneeUserId: string;
  status: string;
  dueAt?: string;
  completedAt?: string;
  subtaskTitle?: string;
  taskId?: string;
  taskNo?: string;
  taskTitle?: string;
  planId?: string;
  managerUserId?: string;
  projectId?: string;
  projectName?: string;
}

export interface PerformanceDataset {
  subtasks: PerformanceSubtaskInput[];
  /** 每个子任务的催办累计（自动+手动）。 */
  reminders: Array<{ subtaskId: string; total: number }>;
  /** 每个子任务的主管逾期提醒次数。 */
  overdueAlerts: Array<{ subtaskId: string; count: number }>;
  /** 曾被改派过的子任务 ID。 */
  reassignedSubtaskIds: string[];
}

export type PerformanceSampleStatus = "scored" | "insufficient" | "inactive";

export interface EmployeePerformanceRow {
  userId: string;
  name?: string;
  /** 有截止的子任务总数（统计窗口内）。 */
  withDueTotal: number;
  doneTotal: number;
  onTimeDone: number;
  lateDone: number;
  /** lateDone / doneTotal，0~1；doneTotal=0 时为 null（无有效迟交率）。 */
  lateRate: number | null;
  /** 展示用迟交率文案（样本不足时为「—」）。 */
  lateRateLabel: string;
  sampleStatus: PerformanceSampleStatus;
  /** 迟交子任务的平均迟交天数（向上以小数天计），无迟交时为 0。 */
  avgLateDays: number;
  /** 最大迟交天数。 */
  maxLateDays: number;
  /** 当前进行中且已逾期的子任务数。 */
  currentlyOverdue: number;
  /** 进行中/待承接（非 DONE/STOPPED）且有截止的子任务数。 */
  inFlightTotal: number;
  /** 催办累计（该员工名下子任务 reminders 之和）。 */
  remindedCount: number;
  /** 主管逾期提醒累计。 */
  managerOverdueAlerts: number;
  /** 名下被改派过的子任务数（公正性标注）。 */
  reassignedInvolved: number;
  /** 已完成但无 completedAt 记录（历史数据），迟交判定存疑的条数。 */
  unknownCompletion: number;
}

export interface EmployeePerformanceFacts {
  generatedAt: string;
  scopeKind: "manager" | "all";
  windowDays: number;
  asOf: string;
  /** 参与统计的有截止子任务总数。 */
  totalSubtasksConsidered: number;
  rows: EmployeePerformanceRow[];
}

export interface BuildPerformanceFactsOptions {
  scopeKind?: "manager" | "all";
  windowDays?: number;
  asOf?: string | number;
  /** userId -> 展示名。 */
  resolveName?: (userId: string) => string | undefined;
}

function roundTo(value: number, digits = 2): number {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}

export function buildEmployeePerformanceFacts(
  dataset: PerformanceDataset,
  options: BuildPerformanceFactsOptions = {},
): EmployeePerformanceFacts {
  const asOfMs = options.asOf === undefined
    ? Date.now()
    : typeof options.asOf === "number"
      ? options.asOf
      : Date.parse(options.asOf);
  const windowDays = options.windowDays && options.windowDays > 0 ? Math.floor(options.windowDays) : 90;
  const cutoffMs = asOfMs - windowDays * MS_PER_DAY;

  const remindersBySubtask = new Map<string, number>();
  for (const r of dataset.reminders) remindersBySubtask.set(r.subtaskId, r.total);
  const alertsBySubtask = new Map<string, number>();
  for (const a of dataset.overdueAlerts) alertsBySubtask.set(a.subtaskId, a.count);
  const reassignedSet = new Set(dataset.reassignedSubtaskIds);

  interface Acc {
    userId: string;
    withDueTotal: number;
    doneTotal: number;
    onTimeDone: number;
    lateDone: number;
    lateDaysSum: number;
    maxLateDays: number;
    currentlyOverdue: number;
    inFlightTotal: number;
    remindedCount: number;
    managerOverdueAlerts: number;
    reassignedInvolved: number;
    unknownCompletion: number;
  }
  const accs = new Map<string, Acc>();
  const ensure = (userId: string): Acc => {
    let acc = accs.get(userId);
    if (!acc) {
      acc = {
        userId,
        withDueTotal: 0,
        doneTotal: 0,
        onTimeDone: 0,
        lateDone: 0,
        lateDaysSum: 0,
        maxLateDays: 0,
        currentlyOverdue: 0,
        inFlightTotal: 0,
        remindedCount: 0,
        managerOverdueAlerts: 0,
        reassignedInvolved: 0,
        unknownCompletion: 0,
      };
      accs.set(userId, acc);
    }
    return acc;
  };

  let totalConsidered = 0;
  for (const sub of dataset.subtasks) {
    const status = String(sub.status ?? "").toUpperCase();
    if (status === "STOPPED") continue;
    const dueMs = parseDueAtMs(sub.dueAt);
    if (dueMs === undefined) continue;
    // 窗口：按截止时间落在 [cutoff, asOf] 内（聚焦近期表现）。
    if (dueMs < cutoffMs || dueMs > asOfMs) continue;
    const userId = sub.assigneeUserId;
    if (!userId) continue;
    totalConsidered += 1;
    const acc = ensure(userId);
    acc.withDueTotal += 1;
    acc.remindedCount += remindersBySubtask.get(sub.subtaskId) ?? 0;
    acc.managerOverdueAlerts += alertsBySubtask.get(sub.subtaskId) ?? 0;
    if (reassignedSet.has(sub.subtaskId)) acc.reassignedInvolved += 1;

    if (status === "DONE") {
      acc.doneTotal += 1;
      const completedMs = sub.completedAt ? Date.parse(sub.completedAt) : NaN;
      if (!Number.isFinite(completedMs)) {
        acc.unknownCompletion += 1;
        acc.onTimeDone += 1; // 无完成时间记录，保守不计迟交
      } else if (completedMs > dueMs) {
        acc.lateDone += 1;
        const lateDays = (completedMs - dueMs) / MS_PER_DAY;
        acc.lateDaysSum += lateDays;
        if (lateDays > acc.maxLateDays) acc.maxLateDays = lateDays;
      } else {
        acc.onTimeDone += 1;
      }
    } else if (!TERMINAL_STATUSES.has(status)) {
      acc.inFlightTotal += 1;
      if (dueMs < asOfMs) acc.currentlyOverdue += 1;
    }
  }

  function buildRow(acc: Acc): EmployeePerformanceRow {
    const scored = acc.doneTotal > 0;
    const lateRate = scored ? acc.lateDone / acc.doneTotal : null;
    const avgLateDays = acc.lateDone > 0 ? acc.lateDaysSum / acc.lateDone : 0;
    let sampleStatus: PerformanceSampleStatus;
    if (scored) sampleStatus = "scored";
    else if (acc.inFlightTotal > 0 || acc.currentlyOverdue > 0) sampleStatus = "insufficient";
    else sampleStatus = "inactive";

    let lateRateLabel = "—";
    if (scored && lateRate !== null) {
      lateRateLabel = `${(lateRate * 100).toFixed(lateRate >= 0.1 ? 0 : 1)}%`;
    } else if (sampleStatus === "insufficient") {
      lateRateLabel = acc.currentlyOverdue > 0 ? "待完成·有逾期" : "待完成";
    } else if (acc.withDueTotal > 0) {
      lateRateLabel = "无完成样本";
    }

    return {
      userId: acc.userId,
      name: options.resolveName?.(acc.userId),
      withDueTotal: acc.withDueTotal,
      doneTotal: acc.doneTotal,
      onTimeDone: acc.onTimeDone,
      lateDone: acc.lateDone,
      lateRate: lateRate === null ? null : roundTo(lateRate, 4),
      lateRateLabel,
      sampleStatus,
      avgLateDays: roundTo(avgLateDays, 2),
      maxLateDays: roundTo(acc.maxLateDays, 2),
      currentlyOverdue: acc.currentlyOverdue,
      inFlightTotal: acc.inFlightTotal,
      remindedCount: acc.remindedCount,
      managerOverdueAlerts: acc.managerOverdueAlerts,
      reassignedInvolved: acc.reassignedInvolved,
      unknownCompletion: acc.unknownCompletion,
    };
  }

  const rows: EmployeePerformanceRow[] = Array.from(accs.values()).map(buildRow);

  const sampleRank = (s: PerformanceSampleStatus) => (s === "scored" ? 0 : s === "insufficient" ? 1 : 2);
  rows.sort((a, b) => {
    const sr = sampleRank(a.sampleStatus) - sampleRank(b.sampleStatus);
    if (sr !== 0) return sr;
    const ar = a.lateRate ?? -1;
    const br = b.lateRate ?? -1;
    if (br !== ar) return br - ar;
    if (b.lateDone !== a.lateDone) return b.lateDone - a.lateDone;
    return b.currentlyOverdue - a.currentlyOverdue;
  });

  return {
    generatedAt: new Date().toISOString(),
    scopeKind: options.scopeKind ?? "all",
    windowDays,
    asOf: new Date(asOfMs).toISOString(),
    totalSubtasksConsidered: totalConsidered,
    rows,
  };
}

export interface PerformanceSubtaskDetailRow {
  subtaskId: string;
  subtaskTitle: string;
  taskId: string;
  taskNo?: string;
  taskTitle: string;
  projectId?: string;
  projectName?: string;
  status: string;
  dueAt?: string;
  completedAt?: string;
  /** on_time | late | overdue | pending | stopped */
  deliveryTag: string;
  lateDays?: number;
  remindedCount: number;
  reassigned: boolean;
}

export interface PerformanceProjectRollup {
  projectId: string;
  projectName: string;
  withDueTotal: number;
  doneTotal: number;
  onTimeDone: number;
  lateDone: number;
  /** 进行中且截止未到。 */
  pendingInFlight: number;
  currentlyOverdue: number;
  employeeCount: number;
}

export interface PerformanceTaskRollup {
  taskId: string;
  taskNo?: string;
  taskTitle: string;
  projectId?: string;
  projectName?: string;
  withDueTotal: number;
  doneTotal: number;
  onTimeDone: number;
  lateDone: number;
  pendingInFlight: number;
  currentlyOverdue: number;
  subtasks: PerformanceSubtaskDetailRow[];
}

export interface EmployeePerformanceDetail {
  employee: EmployeePerformanceRow;
  subtasks: PerformanceSubtaskDetailRow[];
  byProject: PerformanceProjectRollup[];
  byTask: PerformanceTaskRollup[];
}

export interface PerformanceSummaryKpi {
  employeeCount: number;
  scoredEmployeeCount: number;
  employeesWithLate: number;
  totalCurrentlyOverdue: number;
  avgLateRateAmongScored: number | null;
}

function filterSubtasksInWindow(
  dataset: PerformanceDataset,
  windowDays: number,
  asOfMs: number,
  filters?: { userId?: string; projectId?: string },
): PerformanceSubtaskInput[] {
  const cutoffMs = asOfMs - windowDays * MS_PER_DAY;
  const projectFilter = String(filters?.projectId ?? "").trim();
  const userFilter = String(filters?.userId ?? "").trim();
  return dataset.subtasks.filter((sub) => {
    if (String(sub.status ?? "").toUpperCase() === "STOPPED") return false;
    if (userFilter && sub.assigneeUserId !== userFilter) return false;
    if (projectFilter) {
      const pid = sub.projectId ?? "__unassigned__";
      if (projectFilter === "__unassigned__" && sub.projectId) return false;
      if (projectFilter !== "__unassigned__" && pid !== projectFilter) return false;
    }
    const dueMs = parseDueAtMs(sub.dueAt);
    if (dueMs === undefined) return false;
    return dueMs >= cutoffMs && dueMs <= asOfMs;
  });
}

function classifySubtask(
  sub: PerformanceSubtaskInput,
  asOfMs: number,
): { tag: string; lateDays?: number } {
  const status = String(sub.status ?? "").toUpperCase();
  const dueMs = parseDueAtMs(sub.dueAt);
  if (status === "STOPPED") return { tag: "stopped" };
  if (status === "DONE") {
    const completedMs = sub.completedAt ? Date.parse(sub.completedAt) : NaN;
    if (!Number.isFinite(completedMs) || dueMs === undefined) return { tag: "on_time" };
    if (completedMs > dueMs) {
      return { tag: "late", lateDays: roundTo((completedMs - dueMs) / MS_PER_DAY, 2) };
    }
    return { tag: "on_time" };
  }
  if (dueMs !== undefined && dueMs < asOfMs) return { tag: "overdue" };
  return { tag: "pending" };
}

export function buildPerformanceSummaryKpi(rows: EmployeePerformanceRow[]): PerformanceSummaryKpi {
  const scored = rows.filter((r) => r.sampleStatus === "scored");
  const withLate = scored.filter((r) => r.lateDone > 0);
  const rateSum = scored.reduce((s, r) => s + (r.lateRate ?? 0), 0);
  return {
    employeeCount: rows.length,
    scoredEmployeeCount: scored.length,
    employeesWithLate: withLate.length,
    totalCurrentlyOverdue: rows.reduce((s, r) => s + r.currentlyOverdue, 0),
    avgLateRateAmongScored: scored.length > 0 ? roundTo(rateSum / scored.length, 4) : null,
  };
}

export function buildProjectPerformanceRollup(
  dataset: PerformanceDataset,
  options: BuildPerformanceFactsOptions & { projectId?: string } = {},
): PerformanceProjectRollup[] {
  const asOfMs = options.asOf === undefined
    ? Date.now()
    : typeof options.asOf === "number"
      ? options.asOf
      : Date.parse(options.asOf);
  const windowDays = options.windowDays && options.windowDays > 0 ? Math.floor(options.windowDays) : 90;
  const subs = filterSubtasksInWindow(dataset, windowDays, asOfMs, { projectId: options.projectId });
  const byProject = new Map<string, PerformanceProjectRollup & { assignees: Set<string> }>();
  for (const sub of subs) {
    const pid = sub.projectId ?? "__unassigned__";
    const pname = sub.projectName?.trim() || (pid === "__unassigned__" ? "未归类" : pid);
    let row = byProject.get(pid);
    if (!row) {
      row = {
        projectId: pid,
        projectName: pname,
        withDueTotal: 0,
        doneTotal: 0,
        onTimeDone: 0,
        lateDone: 0,
        pendingInFlight: 0,
        currentlyOverdue: 0,
        employeeCount: 0,
        assignees: new Set(),
      };
      byProject.set(pid, row);
    }
    row.withDueTotal += 1;
    row.assignees.add(sub.assigneeUserId);
    const cls = classifySubtask(sub, asOfMs);
    const status = String(sub.status ?? "").toUpperCase();
    if (status === "DONE") {
      row.doneTotal += 1;
      if (cls.tag === "late") row.lateDone += 1;
      else row.onTimeDone += 1;
    } else if (cls.tag === "overdue") {
      row.currentlyOverdue += 1;
    } else if (cls.tag === "pending") {
      row.pendingInFlight += 1;
    }
  }
  return Array.from(byProject.values())
    .map(({ assignees, ...rest }) => ({ ...rest, employeeCount: assignees.size }))
    .sort((a, b) => b.lateDone - a.lateDone || b.currentlyOverdue - a.currentlyOverdue);
}

export function buildEmployeePerformanceDetail(
  dataset: PerformanceDataset,
  userId: string,
  options: BuildPerformanceFactsOptions = {},
): EmployeePerformanceDetail | undefined {
  const facts = buildEmployeePerformanceFacts(dataset, options);
  const employee = facts.rows.find((r) => r.userId === userId);
  if (!employee) return undefined;
  const asOfMs = Date.parse(facts.asOf);
  const subs = filterSubtasksInWindow(dataset, facts.windowDays, asOfMs, { userId });
  const remindersBySubtask = new Map(dataset.reminders.map((r) => [r.subtaskId, r.total]));
  const reassignedSet = new Set(dataset.reassignedSubtaskIds);

  const subtasks: PerformanceSubtaskDetailRow[] = subs.map((sub) => {
    const cls = classifySubtask(sub, asOfMs);
    return {
      subtaskId: sub.subtaskId,
      subtaskTitle: sub.subtaskTitle ?? sub.subtaskId,
      taskId: sub.taskId ?? "",
      taskNo: sub.taskNo,
      taskTitle: sub.taskTitle ?? "",
      projectId: sub.projectId,
      projectName: sub.projectName,
      status: sub.status,
      dueAt: sub.dueAt,
      completedAt: sub.completedAt,
      deliveryTag: cls.tag,
      lateDays: cls.lateDays,
      remindedCount: remindersBySubtask.get(sub.subtaskId) ?? 0,
      reassigned: reassignedSet.has(sub.subtaskId),
    };
  });

  const byTaskMap = new Map<string, PerformanceTaskRollup>();
  for (const st of subtasks) {
    let task = byTaskMap.get(st.taskId);
    if (!task) {
      task = {
        taskId: st.taskId,
        taskNo: st.taskNo,
        taskTitle: st.taskTitle,
        projectId: st.projectId,
        projectName: st.projectName,
        withDueTotal: 0,
        doneTotal: 0,
        onTimeDone: 0,
        lateDone: 0,
        pendingInFlight: 0,
        currentlyOverdue: 0,
        subtasks: [],
      };
      byTaskMap.set(st.taskId, task);
    }
    task.withDueTotal += 1;
    task.subtasks.push(st);
    if (st.deliveryTag === "late") task.lateDone += 1;
    else if (st.deliveryTag === "on_time" && String(st.status).toUpperCase() === "DONE") task.onTimeDone += 1;
    else if (st.deliveryTag === "overdue") task.currentlyOverdue += 1;
    else if (st.deliveryTag === "pending") task.pendingInFlight += 1;
    if (st.status === "DONE") task.doneTotal += 1;
  }
  const byTask = Array.from(byTaskMap.values()).sort(
    (a, b) => b.lateDone - a.lateDone || b.currentlyOverdue - a.currentlyOverdue,
  );

  const byProject = buildProjectPerformanceRollup(
    { ...dataset, subtasks: subs },
    { ...options, asOf: facts.asOf, windowDays: facts.windowDays },
  );

  return { employee, subtasks, byProject, byTask };
}
