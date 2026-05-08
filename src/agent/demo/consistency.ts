import type { TaskPackage } from "../../domain/task-package";
import type { LlmGateSelfCheck } from "./llm-types";
import type { DemoGateResult } from "./gate";

function isoDateParseMs(raw: string): number | undefined {
  const s = raw.trim();
  if (!/^\d{4}-\d{2}-\d{2}/.test(s)) return undefined;
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : undefined;
}

/**
 * Warn-only checks: dangling dependency ids and simple cycles; optional ISO dueAt ordering vs dependencies.
 */
export function collectTaskConsistencyWarnings(tasks: TaskPackage[]): string[] {
  const warnings: string[] = [];
  const idSet = new Set(tasks.map((t) => t.id.trim()).filter(Boolean));
  const idToDueMs = new Map<string, number | undefined>();

  for (const t of tasks) {
    idToDueMs.set(t.id, isoDateParseMs(t.timeNode?.dueAt ?? ""));
  }

  for (const task of tasks) {
    const tid = task.id.trim();
    for (const depId of task.dependencyTaskIds) {
      const d = depId.trim();
      if (!d) continue;
      if (!idSet.has(d)) {
        warnings.push(`任务 "${tid}" 引用了未知的依赖 taskId="${d}"（不存在于当前 tasks 列表）。`);
      }
    }
    const tm = idToDueMs.get(tid);
    if (tm === undefined) continue;
    for (const depId of task.dependencyTaskIds) {
      const dm = idToDueMs.get(depId.trim());
      if (dm === undefined) continue;
      if (tm < dm) {
        warnings.push(
          `任务 "${tid}" 的 dueAt（ISO）早于其依赖 "${depId.trim()}"；请核对时间线是否自洽。`
        );
      }
    }
  }

  const graph = new Map<string, Set<string>>();
  for (const t of tasks) {
    const tid = t.id.trim();
    if (!graph.has(tid)) graph.set(tid, new Set());
    for (const dep of t.dependencyTaskIds) {
      const d = dep.trim();
      if (!idSet.has(d)) continue;
      if (!graph.has(d)) graph.set(d, new Set());
      graph.get(d)!.add(tid); // dependency d must finish before tid
    }
  }

  type Color = "white" | "gray" | "black";
  const color = new Map<string, Color>();

  function dfs(u: string): boolean {
    const c = color.get(u);
    if (c === "gray") return true;
    if (c === "black") return false;
    color.set(u, "gray");
    for (const v of graph.get(u) ?? []) {
      if (dfs(v)) return true;
    }
    color.set(u, "black");
    return false;
  }

  let cycled = false;
  for (const t of tasks) {
    const tid = t.id.trim();
    if ((color.get(tid) ?? "white") !== "white") continue;
    if (dfs(tid)) {
      cycled = true;
      break;
    }
  }

  if (cycled) {
    warnings.push("检测到 dependencyTaskIds 存在循环依赖路径（warn-only）；请拆解或调整前置关系。");
  }

  return warnings;
}

function normalizeMissingField(raw: string): string {
  return raw.trim().toLowerCase();
}

/** When model self-check and hard gate disagree on pass flag, already handled upstream; here overlapping missing fields surface a hint. */
export function collectGateSelfCheckAlignmentWarnings(
  selfCheck: LlmGateSelfCheck | undefined,
  gate: DemoGateResult
): string[] {
  if (!selfCheck?.missingByTask?.length) return [];
  const out: string[] = [];
  for (const hard of gate.missingByTask) {
    const softEntry = selfCheck.missingByTask.find(
      (s) => s.taskId.trim() === hard.taskId.trim()
    );
    if (!softEntry) continue;
    const softSet = new Set(softEntry.missingFields.map(normalizeMissingField));
    const overlap = hard.missingFields.filter((f) => softSet.has(normalizeMissingField(f)));
    if (overlap.length > 0) {
      out.push(
        `任务 ${hard.taskId}：模型的 gateSelfCheck 与派发硬门禁均未通过字段 «${overlap.join(", ")}»；建议在模型输出上直接补全。`
      );
    }
  }
  return out;
}
