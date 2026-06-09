import type { OrgDigest } from "./daily-report-build";
import type { ReportContentField, ReportEntry } from "./dingtalk-report-client";

/** 仅保留 value 非空的工作模块（key 可为空）。 */
export function filterReportContentsWithBody(
  contents: ReportContentField[],
): ReportContentField[] {
  return contents.filter((f) => f.value.trim().length > 0);
}

export function filterReportEntry(entry: ReportEntry): ReportEntry {
  const contents = filterReportContentsWithBody(entry.contents);
  if (contents.length === entry.contents.length) return entry;
  return { ...entry, contents };
}

export function filterOrgDigestsContents(orgDigests: OrgDigest[]): OrgDigest[] {
  return orgDigests.map((org) => ({
    ...org,
    submitted: org.submitted.map((emp) => ({
      ...emp,
      reports: emp.reports.map(filterReportEntry).filter((r) => r.contents.length > 0),
    })),
  }));
}
