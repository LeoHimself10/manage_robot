#!/usr/bin/env node
/**
 * Remove conversationHistory turns polluted with hallucinated OCT-2026-001 replies.
 * Usage: node scripts/clean-polluted-session-history.mjs <session-json-path> [--dry-run]
 */
import fs from "node:fs";

const POLLUTION_MARKERS = ["OCT-2026-001", "OCT主机USB外设兼容性与数据导出稳定性优化专项"];

function isPollutedContent(content) {
  const text = String(content ?? "");
  return POLLUTION_MARKERS.some((m) => text.includes(m));
}

function isPollutedTurn(entry) {
  if (!entry || typeof entry !== "object") return false;
  if (entry.role === "assistant" && isPollutedContent(entry.content)) return true;
  if (
    entry.role === "user" &&
    String(entry.content ?? "").trim() === "已发布的任务有哪些？"
  ) {
    return true;
  }
  return false;
}

function pairPollutedUserAssistant(history, index) {
  const entry = history[index];
  if (!entry) return false;
  if (entry.role === "assistant" && isPollutedContent(entry.content)) {
    const prev = history[index - 1];
    if (
      prev?.role === "user" &&
      String(prev.content ?? "").includes("已发布的任务")
    ) {
      return true;
    }
    return true;
  }
  return false;
}

function cleanHistory(history) {
  const removed = [];
  const kept = [];
  for (let i = 0; i < history.length; i++) {
    const entry = history[i];
    const pollutedAssistant =
      entry.role === "assistant" && isPollutedContent(entry.content);
    const pollutedUserPair =
      entry.role === "user" &&
      String(entry.content ?? "").includes("已发布的任务") &&
      history[i + 1]?.role === "assistant" &&
      isPollutedContent(history[i + 1].content);

    if (pollutedAssistant) {
      removed.push({ index: i, role: entry.role, preview: String(entry.content).slice(0, 80) });
      const prev = kept[kept.length - 1];
      if (
        prev?.role === "user" &&
        String(prev.content ?? "").includes("已发布的任务")
      ) {
        removed.push({
          index: i - 1,
          role: "user",
          preview: String(prev.content).slice(0, 80),
        });
        kept.pop();
      }
      continue;
    }
    if (pollutedUserPair) {
      removed.push({ index: i, role: entry.role, preview: String(entry.content).slice(0, 80) });
      continue;
    }
    kept.push(entry);
  }
  return { kept, removed };
}

const sessionPath = process.argv[2];
const dryRun = process.argv.includes("--dry-run");

if (!sessionPath) {
  console.error("Usage: node clean-polluted-session-history.mjs <session-json-path> [--dry-run]");
  process.exit(1);
}

const raw = fs.readFileSync(sessionPath, "utf8");
const session = JSON.parse(raw);
const history = Array.isArray(session.conversationHistory) ? session.conversationHistory : [];

console.log("session:", sessionPath);
console.log("planId:", session.planId);
console.log("history before:", history.length);

const { kept, removed } = cleanHistory(history);

console.log("removed turns:", removed.length);
for (const r of removed) {
  console.log(" -", r.role, r.preview.replace(/\n/g, " "));
}
console.log("history after:", kept.length);

if (removed.length === 0) {
  console.log("Nothing to clean.");
  process.exit(0);
}

if (dryRun) {
  console.log("Dry run — file not modified.");
  process.exit(0);
}

const backupPath = `${sessionPath}.bak-${Date.now()}`;
fs.copyFileSync(sessionPath, backupPath);
console.log("backup:", backupPath);

session.conversationHistory = kept;
fs.writeFileSync(sessionPath, `${JSON.stringify(session, null, 2)}\n`, "utf8");
console.log("Done.");
