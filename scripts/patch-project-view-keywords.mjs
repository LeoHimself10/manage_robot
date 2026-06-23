#!/usr/bin/env node
/**
 * 为五 projectView 写入 filters.keyword（保留 legacy 字段）。
 * Usage: node scripts/patch-project-view-keywords.mjs /path/to/daily-report-digest.config.json
 */
import fs from "node:fs";

const KEYWORDS = {
  cla: "CLA",
  oct: "OCT",
  "laser-shockwave": "冲击波",
  "large-vessel-plaque": "斑块减容",
  "semiconductor-vein": "半导体",
};

const path = process.argv[2] || "data/daily-report-digest.config.json";
const cfg = JSON.parse(fs.readFileSync(path, "utf8"));
for (const org of cfg.orgs ?? []) {
  for (const pv of org.projectViews ?? []) {
    const kw = KEYWORDS[pv.id];
    if (!kw) continue;
    pv.filters = pv.filters || {};
    pv.filters.keyword = kw;
  }
}
fs.writeFileSync(path, JSON.stringify(cfg, null, 2) + "\n");
console.log("patched keywords for", Object.keys(KEYWORDS).join(", "));
