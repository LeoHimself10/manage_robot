# 微光项目组早报 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Phase 1 — 运维脚本向姚凯珩 1:1 发送 projectView 早报（LLM 综述 + 按人摘要 + 工作台深链），不启用 scheduler。

**Architecture:** 复用 roster 扫描 / SQLite 缓存与 legacy morning LLM 基础设施；新增 projectView 专用 collect/slim/prompt/render 模块，与 `runDailyReportDigest` 解耦。脚本默认 `--to=姚凯珩`，`--dry-run` 仅 stdout。

**Tech Stack:** TypeScript, Vitest, DashScope OpenAI-compatible API, DingTalk robot oToMessages/batchSend

**Spec:** `docs/superpowers/specs/2026-06-09-daily-report-project-view-morning-digest-design.md`

---

### Task 1: Collect + cache loader

**Files:**
- Create: `src/agent/daily-report-digest/daily-report-project-view-digest-collect.ts`
- Test: `tests/agent/daily-report-digest/daily-report-project-view-digest-collect.test.ts`

- [ ] **Step 1:** `resolveProjectViewDigestContext` — find org/view, load roster, read cache or collect + write cache
- [ ] **Step 2:** Unit test cache hit path (mock stores)

### Task 2: ProjectView LLM + fallback

**Files:**
- Create: `src/agent/daily-report-digest/daily-report-project-view-morning-llm.ts`
- Test: `tests/agent/daily-report-digest/daily-report-project-view-morning-llm.test.ts`

- [ ] **Step 1:** `slimProjectViewDigestForLlm`, `fallbackProjectViewMorningSummary` — zero-data natural copy, no「命中」
- [ ] **Step 2:** `summarizeProjectViewMorningWithLlm` — dedicated system prompt, reuse `loadDailyReportMorningLlmConfig`

### Task 3: Render Markdown

**Files:**
- Create: `src/agent/daily-report-digest/daily-report-project-view-morning-render.ts`
- Test: same file as Task 2 or dedicated render tests

- [ ] **Step 1:** `renderProjectViewMorningMarkdown` — no missing/onLeave blocks; stats use rosterCount + submittedCount

### Task 4: Ops script

**Files:**
- Create: `scripts/send-project-view-morning-digest.ts`

- [ ] **Step 1:** CLI `--view` / `--to` (default 姚) / `--date` / `--dry-run`
- [ ] **Step 2:** Wire collect → LLM → render → optional DingTalk send

### Task 5: Verification

- [ ] Run: `npm test -- tests/agent/daily-report-digest/daily-report-project-view-morning-llm.test.ts tests/agent/daily-report-digest/daily-report-project-view-digest-collect.test.ts`
- [ ] Run: `npm run typecheck`
