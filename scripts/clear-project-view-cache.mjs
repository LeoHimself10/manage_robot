#!/usr/bin/env node
/** Delete selected project-view cache entries; optionally also clear a single day partition. */
import { DatabaseSync } from "node:sqlite";
const DEFAULT_VIEWS = [
  "cla",
  "oct",
  "laser-shockwave",
  "large-vessel-plaque",
  "semiconductor-vein",
  "others",
];
const dbPath = process.env.WORKBENCH_SQLITE_PATH || "data/workbench/workbench.sqlite";
const args = process.argv.slice(2);
const dateYmd = args.find((arg) => arg.startsWith("--date="))?.slice("--date=".length);
const orgLabel = args.find((arg) => arg.startsWith("--org="))?.slice("--org=".length) || "微光";
const requestedViews = args.find((arg) => arg.startsWith("--views="))?.slice("--views=".length);
const clearPartition = args.includes("--clear-partition");
const views = requestedViews
  ? requestedViews.split(",").map((value) => value.trim()).filter(Boolean)
  : DEFAULT_VIEWS;
const db = new DatabaseSync(dbPath);
db.exec(`
  CREATE TABLE IF NOT EXISTS daily_report_day_partition_cache (
    org_label TEXT NOT NULL,
    date_ymd TEXT NOT NULL,
    pool_count INTEGER NOT NULL DEFAULT 0,
    payload_json TEXT NOT NULL,
    scanned_at TEXT NOT NULL,
    PRIMARY KEY (org_label, date_ymd)
  );
`);
let deletedViewRows = 0;
for (const viewId of views) {
  if (dateYmd) {
    deletedViewRows += Number(db.prepare("DELETE FROM daily_report_project_view_cache WHERE view_id=? AND date_ymd=?").run(
      viewId,
      dateYmd,
    ).changes);
  } else {
    deletedViewRows += Number(db.prepare("DELETE FROM daily_report_project_view_cache WHERE view_id=?").run(viewId).changes);
  }
}
let deletedPartitionRows = 0;
if (clearPartition) {
  if (dateYmd) {
    deletedPartitionRows = Number(db.prepare("DELETE FROM daily_report_day_partition_cache WHERE org_label=? AND date_ymd=?").run(
      orgLabel,
      dateYmd,
    ).changes);
  } else {
    deletedPartitionRows = Number(db.prepare("DELETE FROM daily_report_day_partition_cache WHERE org_label=?").run(orgLabel).changes);
  }
}
console.log(
  JSON.stringify({ views, dateYmd: dateYmd ?? null, orgLabel, clearPartition, deletedViewRows, deletedPartitionRows }),
);
