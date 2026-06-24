#!/usr/bin/env node
/** Delete project view cache + day partition cache (optional dateYmd / orgLabel). */
import { DatabaseSync } from "node:sqlite";
const views = [
  "cla",
  "oct",
  "laser-shockwave",
  "large-vessel-plaque",
  "semiconductor-vein",
  "others",
];
const dbPath = process.env.WORKBENCH_SQLITE_PATH || "data/workbench/workbench.sqlite";
const dateYmd = process.argv[2];
const orgLabel = process.argv[3] || "微光";
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
for (const viewId of views) {
  if (dateYmd) {
    db.prepare("DELETE FROM daily_report_project_view_cache WHERE view_id=? AND date_ymd=?").run(
      viewId,
      dateYmd,
    );
  } else {
    db.prepare("DELETE FROM daily_report_project_view_cache WHERE view_id=?").run(viewId);
  }
}
if (dateYmd) {
  db.prepare("DELETE FROM daily_report_day_partition_cache WHERE org_label=? AND date_ymd=?").run(
    orgLabel,
    dateYmd,
  );
} else {
  db.prepare("DELETE FROM daily_report_day_partition_cache WHERE org_label=?").run(orgLabel);
}
console.log(
  "cleared view cache for",
  views.join(", "),
  "and partition cache for",
  orgLabel,
  dateYmd ?? "(all dates)",
);
