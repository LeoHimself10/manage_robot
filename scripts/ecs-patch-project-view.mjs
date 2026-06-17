#!/usr/bin/env node
/**
 * Patch 微光 org projectViews in daily-report-digest.config.json on ECS (mingsibot).
 *
 * Run on ECS host (or in container with config mounted):
 *   node scripts/ecs-patch-project-view.mjs
 *
 * Requires mingsibot env:
 *   DAILY_REPORT_DIGEST_CONFIG_FILE=/app/data/daily-report-digest.config.json
 *   WORKBENCH_SQLITE_PATH → dingtalk contacts DB (for org_all discovery / probe)
 *
 * After patch, restart: docker restart manage-robot-mingsibot
 */
import fs from "node:fs";

const CONFIG_PATH =
  process.env.DAILY_REPORT_DIGEST_CONFIG_FILE ||
  "/opt/manage_robot-mingsibot/data/daily-report-digest.config.json";
const ORG_LABEL = "微光";

const SEMICONDUCTOR_VEIN_VIEW = {
  id: "semiconductor-vein",
  label: "半导体激光·静脉项目",
  viewers: ["01451725613871"], // 曹一挥
  exclusiveForViewers: true,
  discoveryDays: 30,
  filters: {
    workModuleContains: "半导体激光",
    costProjectContains: "静脉腔内闭合系统",
  },
};

const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
const org = (cfg.orgs || []).find((o) => o.label === ORG_LABEL);
if (!org) {
  console.error("org not found:", ORG_LABEL);
  process.exit(1);
}

const views = Array.isArray(org.projectViews) ? [...org.projectViews] : [];
const idx = views.findIndex((v) => v?.id === SEMICONDUCTOR_VEIN_VIEW.id);
if (idx >= 0) {
  views[idx] = SEMICONDUCTOR_VEIN_VIEW;
} else {
  views.push(SEMICONDUCTOR_VEIN_VIEW);
}
org.projectViews = views;

fs.writeFileSync(CONFIG_PATH, `${JSON.stringify(cfg, null, 2)}\n`, "utf8");
console.log(
  `[ok] projectViews patched for ${ORG_LABEL}: ${SEMICONDUCTOR_VEIN_VIEW.id} (${SEMICONDUCTOR_VEIN_VIEW.label}) viewer 曹一挥`,
);
