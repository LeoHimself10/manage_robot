import type { OrgDigest } from "./daily-report-build";
import { fieldHasDisplayBody, reportHasDisplayBody } from "./daily-report-attachments";
import type { ReportContentField, ReportEntry } from "./dingtalk-report-client";

/** 保留 value 非空或含附件的工作模块。 */
export function filterReportContentsWithBody(
  contents: ReportContentField[],
): ReportContentField[] {
  return contents.filter(fieldHasDisplayBody);
}

export function filterReportEntry(entry: ReportEntry): ReportEntry {
  const contents = filterReportContentsWithBody(entry.contents);
  if (!reportHasDisplayBody({ ...entry, contents })) {
    return { ...entry, contents: [] };
  }
  if (contents.length === entry.contents.length) return entry;
  return { ...entry, contents };
}

export function filterOrgDigestsContents(orgDigests: OrgDigest[]): OrgDigest[] {
  return orgDigests.map((org) => ({
    ...org,
    submitted: org.submitted.map((emp) => ({
      ...emp,
      reports: emp.reports.map(filterReportEntry).filter(reportHasDisplayBody),
    })),
  }));
}
