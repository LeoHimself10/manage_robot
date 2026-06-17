#!/usr/bin/env node
/**
 * Patch 微光 org projectViews → **managebot**（manage-robot-dingtalk）config。
 *
 * 微光新业务跑 managebot.vivolightsales.com，不是 mingsibot。
 * legacy 明思+微光 6 人日报仍在 mingsibot，勿在此脚本改 mingsibot config。
 *
 * Run on ECS:
 *   node scripts/ecs-patch-project-view.mjs
 *
 * Env on managebot (/etc/manage-robot.env):
 *   DAILY_REPORT_PROJECT_VIEWS_ENABLED=1
 *   DAILY_REPORT_DIGEST_CONFIG_FILE=/app/data/daily-report-digest.config.json
 *   DAILY_REPORTS_PAGE_ENABLED=1
 *
 * After patch: bash scripts/ecs-deploy-managebot-project-view.sh  (或 stop/rm/run dingtalk)
 */
import fs from "node:fs";

const CONFIG_PATH =
  process.env.DAILY_REPORT_DIGEST_CONFIG_FILE ||
  "/opt/manage_robot/data/daily-report-digest.config.json";
const MINGSIBOT_CONFIG_FALLBACK =
  "/opt/manage_robot-mingsibot/data/daily-report-digest.config.json";
const ORG_LABEL = "微光";

const SEMICONDUCTOR_VEIN_VIEW = {
  id: "semiconductor-vein",
  label: "半导体激光·静脉项目",
  viewers: ["01451725613871", "641871342"], // 曹一挥、姚凯珩（微光 userid）
  exclusiveForViewers: true,
  discoveryDays: 30,
  filters: {
    workModuleContains: "半导体激光",
    costProjectContains: "静脉腔内闭合系统",
  },
  digest: {
    enabled: true,
    sendHour: 8,
    sendMinute: 0,
    excludeUserIds: ["01451725613871"],
  },
};

function readJson(path) {
  return JSON.parse(fs.readFileSync(path, "utf8"));
}

function loadOrBootstrapConfig() {
  if (fs.existsSync(CONFIG_PATH)) {
    return readJson(CONFIG_PATH);
  }
  if (!fs.existsSync(MINGSIBOT_CONFIG_FALLBACK)) {
    console.error("config missing:", CONFIG_PATH, "and no fallback at", MINGSIBOT_CONFIG_FALLBACK);
    process.exit(1);
  }
  const src = readJson(MINGSIBOT_CONFIG_FALLBACK);
  const weiguang = (src.orgs || []).find((o) => o.label === ORG_LABEL);
  if (!weiguang) {
    console.error("微光 org not found in fallback config");
    process.exit(1);
  }
  console.log("[bootstrap] creating managebot config from mingsibot 微光 org only (no legacy employees digest on managebot)");
  return {
    enabled: false,
    timezone: src.timezone || "Asia/Shanghai",
    scanIntervalMs: src.scanIntervalMs || 60000,
    sendHour: src.sendHour ?? 7,
    sendMinute: src.sendMinute ?? 0,
    reportDayCutoffHour: src.reportDayCutoffHour ?? 17,
    reportDayCutoffMinute: src.reportDayCutoffMinute ?? 0,
    title: "微光项目组日报",
    pushMode: "full",
    stateDir: "/app/data/daily-report-state",
    webhook: { accessToken: "" },
    orgs: [
      {
        label: ORG_LABEL,
        appKey: weiguang.appKey,
        appSecret: weiguang.appSecret,
        templateName: weiguang.templateName || "",
        employees: [],
        projectViews: [],
      },
    ],
  };
}

const cfg = loadOrBootstrapConfig();
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

fs.mkdirSync(CONFIG_PATH.replace(/[/\\][^/\\]+$/, ""), { recursive: true });
fs.writeFileSync(CONFIG_PATH, `${JSON.stringify(cfg, null, 2)}\n`, "utf8");
console.log(
  `[ok] managebot config ${CONFIG_PATH}: projectViews patched for ${ORG_LABEL} → ${SEMICONDUCTOR_VEIN_VIEW.id}`,
);
