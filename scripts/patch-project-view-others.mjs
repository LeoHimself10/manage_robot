#!/usr/bin/env node
/**
 * Append「其他」projectView to managebot digest config.
 * Usage: node scripts/patch-project-view-others.mjs [configPath]
 */
import fs from "node:fs";

const path = process.argv[2] || "data/daily-report-digest.config.json";
const OTHERS_VIEW = {
  id: "others",
  label: "其他",
  viewers: ["01451725613871"],
  exclusiveForViewers: true,
  filters: { role: "others" },
  digest: {
    enabled: true,
    sendHour: 7,
    sendMinute: 0,
  },
};

const cfg = JSON.parse(fs.readFileSync(path, "utf8"));
const org = (cfg.orgs || []).find((o) => o.label === "微光");
if (!org) {
  console.error("微光 org not found");
  process.exit(1);
}
const views = Array.isArray(org.projectViews) ? [...org.projectViews] : [];
const idx = views.findIndex((v) => v?.id === "others");
if (idx >= 0) {
  views[idx] = { ...views[idx], ...OTHERS_VIEW };
} else {
  views.push(OTHERS_VIEW);
}
org.projectViews = views;
fs.writeFileSync(path, JSON.stringify(cfg, null, 2) + "\n");
console.log("[ok] patched others projectView →", path);
