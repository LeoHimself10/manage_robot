import http from "node:http";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createQualityStore } from "../../src/quality/infra/quality-store";
import { createQualitySourceSync } from "../../src/quality/source/quality-source-sync";
import { handleQualityMaApi, isQualityMaApiPath } from "../../src/web/quality-ma-http";

let dir = ""; let server: http.Server; let base = "";
const key = "feedback:MA-HTTP-001";
const path = `/api/workbench/quality/ma/feedbacks/${encodeURIComponent(key)}`;
const version = () => ({ requestId: randomUUID(), expectedSourceVersion: 1 });
const form = () => ({ ...version(), expectedVersion: 0, categoryMode: "STANDARD", primaryCategoryCode: "CATHETER_PRODUCT", secondaryCategoryCode: "CATHETER_BEND_SHAKE", riskLevel: "HIGH", conclusion: "导管弯折，需要实物验证。", adoptionMode: "MANUAL" });
async function request(url: string, method = "GET", payload?: unknown, actor = "ma", external = false) {
  return fetch(`${base}${url}`, { method, headers: { "Content-Type": "application/json", "x-test-user": actor, "x-test-external": String(external) }, body: payload ? JSON.stringify(payload) : undefined });
}
beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "quality-ma-http-")); const dbPath = join(dir, "workbench.sqlite");
  vi.stubEnv("WORKBENCH_SQLITE_PATH", dbPath); vi.stubEnv("WORKBENCH_MANAGER_USER_IDS", "ma,other");
  vi.stubEnv("QUALITY_AFTERSALES_MANAGER_USER_IDS", "ma,other"); vi.stubEnv("WORKBENCH_ADMIN_USER_IDS", "admin");
  vi.stubEnv("QUALITY_SPECIALIST_USER_IDS", "tong");
  createQualityStore(dbPath).close();
  const sync = createQualitySourceSync({ dbPath, reader: { readFirstSheet: async () => ({ sheetId: "sheet-http", sheetName: "客户端问题反馈记录表", rows: [["反馈时间", "反馈单号", "问题描述"], ["2026-09-09", "MA-HTTP-001", "导管弯折"]] }) } });
  await sync.syncNow(); sync.close();
  server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (!isQualityMaApiPath(url.pathname)) { res.writeHead(404).end(); return; }
    void handleQualityMaApi({ req, res, url, session: { userId: String(req.headers["x-test-user"] ?? ""), role: "manager", loginSource: req.headers["x-test-external"] === "true" ? "external_password" : "entry" } });
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); if (!address || typeof address === "string") throw new Error("server missing"); base = `http://127.0.0.1:${address.port}`;
});
afterEach(async () => { await new Promise<void>(resolve => server.close(() => resolve())); vi.unstubAllEnvs(); rmSync(dir, { recursive: true, force: true }); });

describe("马荣鑫 API 边界", () => {
  it("服务端拒绝外部密码、admin、普通员工与未准入直接写入", async () => {
    for (const actor of ["admin", "employee", "tong"]) expect((await request(path, "GET", undefined, actor)).status).toBe(403);
    expect((await request(path, "GET", undefined, "ma", true)).status).toBe(403);
    expect((await request(`${path}/assessment`, "POST", form())).status).toBe(409);
    expect((await request(`${path}/ai`, "POST", version())).status).toBe(409);
    expect((await request(`${path}/submit`, "POST", { ...version(), expectedAssessmentVersion: 1 })).status).toBe(409);
  });
  it("新API贯通准入、保存和明确推送，错误版本不覆盖，其他主管无法读取后续结果", async () => {
    const before = await (await request("/api/workbench/quality/ma/feedbacks?scope=pending")).json();
    expect(before.data.items).toHaveLength(0); expect(before.data.integration.connected).toBe(false);
    expect((await request(`${path}/admit`, "POST", version())).status).toBe(200);
    expect((await request(`${path}/assessment`, "POST", { ...form(), handlingRecommendation: "ORDINARY" })).status).toBe(400);
    const saved = await (await request(`${path}/assessment`, "POST", form())).json();
    expect(saved.data).toMatchObject({ stage: "READY_TO_SUBMIT", event: null });
    expect((await request(`${path}/assessment`, "POST", form())).status).toBe(409);
    const pushed = await (await request(`${path}/submit`, "POST", { ...version(), expectedAssessmentVersion: 1 })).json();
    expect(pushed.data).toMatchObject({ event: { status: "PENDING_ANALYSIS" }, canAssess: false, downstream: { readonly: true } });
    expect((await request(path, "GET", undefined, "other")).status).toBe(404);
    expect((await request(`${path}/delegate`, "POST", {})).status).toBe(404);
    expect((await request(`${path}/assessment`, "PUT", form())).status).toBe(405);
  });
});
