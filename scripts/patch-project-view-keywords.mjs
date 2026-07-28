#!/usr/bin/env node
/**
 * Restore the semiconductor view and keep the vein-closure view cost-project-only.
 * Usage: node scripts/patch-project-view-keywords.mjs /path/to/daily-report-digest.config.json
 */
import fs from "node:fs";

const VIEW_PATCH = {
  cla: { label: "CLA", keyword: "CLA" },
  oct: { label: "OCT", keyword: "OCT" },
  "laser-shockwave": { label: "冲击波", keyword: "冲击波" },
  "large-vessel-plaque": { label: "斑块减容", keyword: "斑块减容" },
  "semiconductor-vein": { label: "半导体", keyword: "半导体" },
  "vein-closure-system": { label: "静脉腔闭合系统", costProjectContains: "静脉腔" },
};

const path = process.argv[2] || "data/daily-report-digest.config.json";
const cfg = JSON.parse(fs.readFileSync(path, "utf8"));
for (const org of cfg.orgs ?? []) {
  for (const pv of org.projectViews ?? []) {
    const patch = VIEW_PATCH[pv.id];
    if (!patch) continue;
    pv.label = patch.label;
    pv.filters = pv.filters || {};
    if (patch.keyword) {
      pv.filters.keyword = patch.keyword;
      delete pv.filters.workModuleContains;
      delete pv.filters.costProjectContains;
    }
    else {
      delete pv.filters.keyword;
      delete pv.filters.workModuleContains;
      pv.filters.costProjectContains = patch.costProjectContains;
    }
  }
}
fs.writeFileSync(path, JSON.stringify(cfg, null, 2) + "\n");
console.log("patched label+keyword for", Object.keys(VIEW_PATCH).join(", "));
