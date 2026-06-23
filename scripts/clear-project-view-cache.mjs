#!/usr/bin/env node
/** Delete cache rows for five digest views (optional dateYmd arg). */
import { DatabaseSync } from "node:sqlite";
const views = ["cla","oct","laser-shockwave","large-vessel-plaque","semiconductor-vein"];
const dbPath = process.env.WORKBENCH_SQLITE_PATH || "data/workbench/workbench.sqlite";
const dateYmd = process.argv[2];
const db = new DatabaseSync(dbPath);
for (const viewId of views) {
  if (dateYmd) {
    db.prepare("DELETE FROM daily_report_project_view_cache WHERE view_id=? AND date_ymd=?").run(viewId, dateYmd);
  } else {
    db.prepare("DELETE FROM daily_report_project_view_cache WHERE view_id=?").run(viewId);
  }
}
console.log("cleared cache for", views.join(", "), dateYmd ?? "(all dates)");
