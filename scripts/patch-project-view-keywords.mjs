#!/usr/bin/env node
/**
 * 为五 projectView 写入短 label + filters.keyword（保留 legacy 成对字段）。
 * Usage: node scripts/patch-project-view-keywords.mjs /path/to/daily-report-digest.config.json
 */
import fs from "node:fs";

const VIEW_PATCH = {
  cla: { label: "CLA", keyword: "CLA" },
  oct: { label: "OCT", keyword: "OCT" },
  "laser-shockwave": { label: "冲击波", keyword: "冲击波" },
  "large-vessel-plaque": { label: "斑块减容", keyword: "斑块减容" },
  "semiconductor-vein": { label: "半导体", keyword: "半导体" },
};

const path = process.argv[2] || "data/daily-report-digest.config.json";
const cfg = JSON.parse(fs.readFileSync(path, "utf8"));
for (const org of cfg.orgs ?? []) {
  for (const pv of org.projectViews ?? []) {
    const patch = VIEW_PATCH[pv.id];
    if (!patch) continue;
    pv.label = patch.label;
    pv.filters = pv.filters || {};
    pv.filters.keyword = patch.keyword;
  }
}
fs.writeFileSync(path, JSON.stringify(cfg, null, 2) + "\n");
console.log("patched label+keyword for", Object.keys(VIEW_PATCH).join(", "));
