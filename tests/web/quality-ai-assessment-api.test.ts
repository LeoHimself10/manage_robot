import http from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createQualityStore } from "../../src/quality/infra/quality-store";
import { runQualitySourceAiAssessment } from
  "../../src/quality/reviews/quality-source-ai-assessment-service";
import { createQualitySourceSync } from "../../src/quality/source/quality-source-sync";
import { handleQualityHttp } from "../../src/web/quality-http";

const tempDirs: string[] = [];
const servers: http.Server[] = [];

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  while (tempDirs.length) rmSync(tempDirs.pop()!, { recursive: true, force: true });
});

async function seedSource(): Promise<{ dbPath: string; sourceKey: string }> {
  const dir = mkdtempSync(join(tmpdir(), "quality-ai-http-"));
  tempDirs.push(dir);
  const dbPath = join(dir, "quality.sqlite");
  createQualityStore(dbPath).close();
  const sync = createQualitySourceSync({
    dbPath,
    reader: {
      readFirstSheet: async () => ({
        sheetId: "sheet-api",
        sheetName: "客户端问题反馈记录表",
        rows: [
          ["反馈时间", "反馈单号", "反馈人员", "设备型号", "设备序列号", "问题描述", "对术者造成的影响"],
          ["2026-08-21", "API-001", "脱敏人员", "OCT-M1", "SN-API", "导管弯折导致操作暂停", "操作暂停"],
        ],
      }),
    },
  });
  await sync.syncNow();
  sync.close();
  return { dbPath, sourceKey: "feedback:API-001" };
}

async function startQualityServer(): Promise<string> {
  const server = http.createServer((req, res) => {
    const userId = String(req.headers["x-test-user"] ?? "");
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "127.0.0.1"}`);
    if (handleQualityHttp({
      req,
      res,
      url,
      session: { userId, role: "manager", loginSource: "entry" },
    })) return;
    res.writeHead(404).end();
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("test server did not start");
  return `http://127.0.0.1:${address.port}`;
}

describe("单条AI研判HTTP权限与输入边界", () => {
  it("有权限用户可调用，无权限用户被拒绝，且请求只允许sourceKey", async () => {
    const seeded = await seedSource();
    vi.stubEnv("WORKBENCH_SQLITE_PATH", seeded.dbPath);
    vi.stubEnv("WORKBENCH_MANAGER_USER_IDS", "after-1");
    vi.stubEnv("QUALITY_AFTERSALES_MANAGER_USER_IDS", "after-1");
    vi.stubEnv("QUALITY_SPECIALIST_USER_IDS", "specialist-1");
    vi.stubEnv("QWEN_API_KEY", "offline-http-test-key");
    vi.stubEnv("QWEN_MODEL", "qwen-offline-http-test");
    const realFetch = globalThis.fetch.bind(globalThis);
    const modelFetch = vi.fn(async (_url: string | URL | Request) => {
      const output = {
        handlingRecommendation: "QUALITY_ANOMALY",
        primaryCategoryCode: "CATHETER_PRODUCT",
        secondaryCategoryCode: "CATHETER_BEND_SHAKE",
        riskLevel: "HIGH",
        reasoningBasis: [{ statement: "导管弯折导致操作暂停。", citationIds: ["feedback-1"] }],
        similarCases: [],
        missingInformation: [],
        uncertainties: [{ topic: "根因", reason: "需要实物检查。" }],
        citations: [{ citationId: "feedback-1", sourceType: "FEEDBACK", sourceId: seeded.sourceKey, description: "来源快照" }],
      };
      return {
        ok: true,
        status: 200,
        json: async () => ({
          id: "offline-http-model",
          model: "qwen-offline-http-test",
          choices: [{ message: { content: JSON.stringify(output) } }],
          usage: { prompt_tokens: 100, completion_tokens: 80, total_tokens: 180 },
        }),
      } as Response;
    });
    vi.stubGlobal("fetch", modelFetch);
    const baseUrl = await startQualityServer();

    const denied = await realFetch(`${baseUrl}/api/workbench/quality/assessments/ai`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-test-user": "specialist-1" },
      body: JSON.stringify({ sourceKey: seeded.sourceKey }),
    });
    expect(denied.status).toBe(403);
    expect(modelFetch).not.toHaveBeenCalled();

    const untrustedContent = await realFetch(`${baseUrl}/api/workbench/quality/assessments/ai`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-test-user": "after-1" },
      body: JSON.stringify({ sourceKey: seeded.sourceKey, issueDescription: "前端伪造内容" }),
    });
    expect(untrustedContent.status).toBe(400);
    expect(modelFetch).not.toHaveBeenCalled();

    await expect(runQualitySourceAiAssessment({
      dbPath: seeded.dbPath,
      sourceKey: seeded.sourceKey,
      requestId: "direct-qwen-http-test",
    })).resolves.toMatchObject({ sourceKey: seeded.sourceKey });

    const allowed = await realFetch(`${baseUrl}/api/workbench/quality/assessments/ai`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-test-user": "after-1" },
      body: JSON.stringify({ sourceKey: seeded.sourceKey }),
    });
    const payload = await allowed.json() as {
      ok: boolean;
      data: { output: { primaryCategoryCode: string }; retrievedCases: Array<{ caseId: string }> };
    };
    expect(allowed.status).toBe(200);
    expect(payload.ok).toBe(true);
    expect(payload.data.output.primaryCategoryCode).toBe("CATHETER_PRODUCT");
    expect(payload.data.retrievedCases.length).toBeLessThanOrEqual(3);
    expect(payload.data.retrievedCases.every((item) => !item.caseId.startsWith("CASE-TEST-"))).toBe(true);
    expect(modelFetch).toHaveBeenCalledTimes(2);
  });
});
