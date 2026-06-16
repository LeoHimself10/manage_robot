import type { DailyReportOrgConfig } from "./daily-report-config";
import type { OrgDigest } from "./daily-report-build";
import {
  createDingTalkLeaveClient,
  type DingTalkLeaveClient,
  type LeaveStatusEntry,
} from "./dingtalk-leave-client";
import { logStructured } from "../../infra/logger";

export interface EmployeeRef {
  userid: string;
  name: string;
}

/** 全天请假：percent_day 且 duration_percent >= 100（100 = 1 天）。 */
export function isFullDayLeave(entry: LeaveStatusEntry): boolean {
  return entry.durationUnit === "percent_day" && entry.durationPercent >= 100;
}

/** 请假时段与查询窗口是否有交集。 */
export function leaveOverlapsWindow(
  entry: LeaveStatusEntry,
  startTime: number,
  endTime: number,
): boolean {
  if (!entry.startTime || !entry.endTime) return false;
  return entry.startTime < endTime && entry.endTime > startTime;
}

/** 从 missing 中拆出全天请假的员工（纯函数，便于测试）。 */
export function splitMissingByFullDayLeave(
  missing: EmployeeRef[],
  leaveEntries: LeaveStatusEntry[],
  window: { startTime: number; endTime: number },
): { missing: EmployeeRef[]; onLeave: EmployeeRef[] } {
  const fullDayUserIds = new Set<string>();
  for (const entry of leaveEntries) {
    if (!isFullDayLeave(entry)) continue;
    if (!leaveOverlapsWindow(entry, window.startTime, window.endTime)) continue;
    if (entry.userid) fullDayUserIds.add(entry.userid);
  }
  const onLeave: EmployeeRef[] = [];
  const stillMissing: EmployeeRef[] = [];
  for (const m of missing) {
    if (fullDayUserIds.has(m.userid)) onLeave.push(m);
    else stillMissing.push(m);
  }
  return { missing: stillMissing, onLeave };
}

export async function applyLeaveToOrgDigests(
  orgDigests: OrgDigest[],
  orgConfigs: DailyReportOrgConfig[],
  window: { startTime: number; endTime: number },
  opts?: {
    enabled?: boolean;
    leaveClient?: DingTalkLeaveClient;
    fetchImpl?: typeof fetch;
  },
): Promise<OrgDigest[]> {
  if (opts?.enabled === false) return orgDigests;
  const client = opts?.leaveClient ?? createDingTalkLeaveClient({ fetchImpl: opts?.fetchImpl });
  const configByLabel = new Map(orgConfigs.map((o) => [o.label, o]));

  return Promise.all(
    orgDigests.map(async (digest) => {
      if (digest.missing.length === 0) {
        return { ...digest, onLeave: digest.onLeave ?? [] };
      }
      const org = configByLabel.get(digest.label);
      if (!org) return { ...digest, onLeave: digest.onLeave ?? [] };
      const userids = digest.missing.map((m) => m.userid);
      try {
        const leaveEntries = await client.fetchLeaveStatus({
          appKey: org.appKey,
          appSecret: org.appSecret,
          userids,
          startTime: window.startTime,
          endTime: window.endTime,
        });
        const split = splitMissingByFullDayLeave(digest.missing, leaveEntries, window);
        return { ...digest, missing: split.missing, onLeave: split.onLeave };
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        logStructured({
          event: "daily_report_leave_fetch_failed",
          org: digest.label,
          reason,
        });
        return { ...digest, onLeave: digest.onLeave ?? [] };
      }
    }),
  );
}
