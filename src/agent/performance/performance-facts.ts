/**
 * 员工迟交/延期绩效聚合（纯函数，只读）。
 *
 * 口径：
 * - 仅统计有可解析截止时间（due_at）的子任务（无截止无法判定迟交）。
 * - 迟交完成：status=DONE 且 completedAt > effectiveDue。
 * - 准时完成：status=DONE 且 completedAt <= effectiveDue（无 completedAt 时回退按未迟交处理并计入 unknownCompletion）。
 * - 当前逾期：status 非终结态（DONE/STOPPED）且 effectiveDue < asOf。
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

export interface EmployeePerformanceRow {
  userId: string;
  name?: string;
  /** 有截止的子任务总数（统计窗口内）。 */
  withDueTotal: number;
  doneTotal: number;
  onTimeDone: number;
  lateDone: number;
  /** lateDone / doneTotal，0~1；doneTotal=0 时为 0。 */
  lateRate: number;
  /** 迟交子任务的平均迟交天数（向上以小数天计），无迟交时为 0。 */
  avgLateDays: number;
  /** 最大迟交天数。 */
  maxLateDays: number;
  /** 当前进行中且已逾期的子任务数。 */
  currentlyOverdue: number;
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

    const status = String(sub.status ?? "").toUpperCase();
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
      if (dueMs < asOfMs) acc.currentlyOverdue += 1;
    }
  }

  const rows: EmployeePerformanceRow[] = Array.from(accs.values()).map((acc) => {
    const lateRate = acc.doneTotal > 0 ? acc.lateDone / acc.doneTotal : 0;
    const avgLateDays = acc.lateDone > 0 ? acc.lateDaysSum / acc.lateDone : 0;
    return {
      userId: acc.userId,
      name: options.resolveName?.(acc.userId),
      withDueTotal: acc.withDueTotal,
      doneTotal: acc.doneTotal,
      onTimeDone: acc.onTimeDone,
      lateDone: acc.lateDone,
      lateRate: roundTo(lateRate, 4),
      avgLateDays: roundTo(avgLateDays, 2),
      maxLateDays: roundTo(acc.maxLateDays, 2),
      currentlyOverdue: acc.currentlyOverdue,
      remindedCount: acc.remindedCount,
      managerOverdueAlerts: acc.managerOverdueAlerts,
      reassignedInvolved: acc.reassignedInvolved,
      unknownCompletion: acc.unknownCompletion,
    };
  });

  // 「经常迟交」排序：先迟交率，再迟交数，再当前逾期数。
  rows.sort((a, b) => {
    if (b.lateRate !== a.lateRate) return b.lateRate - a.lateRate;
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
