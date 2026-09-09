import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { aiOriginalAssessmentInputSchema, type AiOriginalAssessmentInput, type AiOriginalAssessmentOutput } from "../../src/quality/ai-original-assessment/ai-original-assessment-contracts";
import { buildAiOriginalAssessmentV0Messages } from "../../src/quality/ai-original-assessment/ai-original-assessment-v0-prompt";
import { prepareAiOriginalAssessmentV0, prepareAiOriginalAssessmentV0FromNormalizedFeedback } from "../../src/quality/ai-original-assessment/ai-original-assessment-v0-runner";
import { createMaWorkbenchService } from "../../src/quality/ma-workbench/service";
import { ingestQualityOaInstance } from "../../src/quality/oa/quality-oa-source";
import { runQualitySourceAiAssessment } from "../../src/quality/reviews/quality-source-ai-assessment-service";
import { createQualitySourceAssessmentService } from "../../src/quality/reviews/quality-source-assessment-service";

let dir = ""; let dbPath = "";
const sourceKey = "oa:CONTEXT-001";
const facts = {
  "产品类型选项": "OCT", "设备型号": "Classic A", "导管型号": "A2", "设备序列号": "SN-001",
  "软件版本": "10.4.2", "导管生产批号": "B-002", "导管是否可以回收寄回": "是",
  "本次报损的导管数量（条）": "1", "WHAT": "导管推送时头端发生变形",
  "WHERE": "本地测试医院", "WHEN": "2026-09-08", "HOW": "支架近端位于血管中间，导管推送至支架后无法继续",
  "HOW MANY": "3", "影响程度": "操作暂停，需更换导管",
  "赔付地址和收件人信息": "不得传入模型的收件电话 13800000000", "手写签名": "private-signature",
};
function seed(overrides: Record<string, string> = {}) {
  return ingestQualityOaInstance({ dbPath, processInstanceId: "CONTEXT-001", processCode: "LOCAL-FLOW", reporterName: "本地提交人",
    instance: { businessId: "OA-001", originatorUserId: "private-originator-id", status: "RUNNING", createTime: "2026-09-09T01:00:00.000Z",
      formComponentValues: Object.entries({ ...facts,
        "上传问题记录图片及视频": JSON.stringify([{ fileId: "private-file-id", fileName: "现场记录.mp4", mimeType: "video/mp4", fileSize: 1024, downloadUrl: "https://files.invalid/video?token=private-token", uploader: "private-uploader" }]),
        "服务日志导出并上传": JSON.stringify({ files: [{ name: "设备日志.txt", size: 40, mimeType: "text/plain", url: "https://files.invalid/log?token=private-token" }] }),
        ...overrides,
      }).map(([name, value]) => ({ name, value })),
    },
  });
}
function validOutput(input: AiOriginalAssessmentInput): AiOriginalAssessmentOutput {
  return { schemaVersion: "ai-original-assessment-output-v0", requestId: input.runMetadata.requestId,
    handlingRecommendation: "QUALITY_ANOMALY", primaryCategoryCode: "CATHETER_PRODUCT", secondaryCategoryCode: "CATHETER_PASSAGE_SHAPE", riskLevel: "HIGH",
    reasoningBasis: [{ statement: "推送路径中导管头端变形，需实物核对。", citationIds: ["F1"] }], similarCases: [], missingInformation: [],
    uncertainties: [{ topic: "实物", reason: "附件内容未读取，仍需人工核对。" }], citations: [{ citationId: "F1", sourceType: "FEEDBACK", sourceId: input.sourceSnapshot.sourceKey, description: "OA表单事实" }],
    provenance: { modelConfigId: input.runMetadata.modelConfigId, promptVersion: input.runMetadata.promptVersion, categoryDictionaryVersion: input.categoryDictionary.version, caseLibraryVersion: input.runMetadata.caseLibraryVersion } };
}
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "quality-ma-oa-context-")); dbPath = join(dir, "quality.sqlite");
  vi.stubEnv("WORKBENCH_SQLITE_PATH", dbPath); vi.stubEnv("WORKBENCH_MANAGER_USER_IDS", "ma");
  vi.stubEnv("QUALITY_AFTERSALES_MANAGER_USER_IDS", "ma"); vi.stubEnv("QUALITY_SPECIALIST_USER_IDS", "tong");
  vi.stubEnv("QUALITY_MANAGEMENT_USER_IDS", "tong");
});
afterEach(() => { vi.unstubAllEnvs(); rmSync(dir, { recursive: true, force: true }); });

describe("OA 输入进入真实研判路径", () => {
  it("表单上下文进入模型消息，附件仅元数据；AI与正式通报来源快照保留全部事实且不被新版覆盖", async () => {
    seed();
    let captured: AiOriginalAssessmentInput | undefined;
    let modelMessages = "";
    const result = await runQualitySourceAiAssessment({ dbPath, sourceKey, requestId: "oa-context-ai", actorUserId: "ma",
      caseRetriever: { version: "local-empty-v1", retrieve: () => [] },
      model: { generate: async ({ input }) => {
        captured = input;
        const messages = buildAiOriginalAssessmentV0Messages({ assessmentInput: input });
        modelMessages = JSON.stringify(messages);
        const output = validOutput(input);
        return { payload: output, rawContent: JSON.stringify(output), messages, toolCallsExecuted: 0,
          trace: { requestId: input.runMetadata.requestId, model: "offline-capture", tokenUsage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 }, latencyMs: 0 } };
      } },
    });
    expect(captured?.sourceSnapshot.oaContext).toMatchObject({ productType: "OCT", catheterModel: "A2", softwareVersion: "10.4.2",
      hospital: facts.WHERE, occurredAt: facts.WHEN, reproduction: facts.HOW, occurrenceCount: "3", returnable: "是", damagedCount: "1", attachmentContent: "NOT_ANALYZED" });
    for (const value of [facts.HOW, facts.WHERE, facts.WHEN, facts["软件版本"], "occurrenceCount", "damagedCount", "returnable"]) expect(modelMessages).toContain(value);
    expect(captured?.sourceSnapshot.oaContext?.attachments).toEqual([
      { category: "服务日志导出并上传", name: "设备日志.txt", mimeType: "text/plain", sizeBytes: 40 },
      { category: "上传问题记录图片及视频", name: "现场记录.mp4", mimeType: "video/mp4", sizeBytes: 1024 },
    ]);
    expect(modelMessages).toContain("附件内容未读取或分析");
    for (const privateValue of ["private-token", "private-file-id", "private-originator-id", "private-signature", "13800000000", "private-uploader", "https://files.invalid"]) expect(modelMessages).not.toContain(privateValue);
    expect(result.output.provenance.promptVersion).toBe("quality-ai-original-assessment-prompt-v0.12-oa-context");
    expect(aiOriginalAssessmentInputSchema.safeParse({ ...captured, sourceSnapshot: { ...captured!.sourceSnapshot, oaContext: { ...captured!.sourceSnapshot.oaContext, originatorUserId: "disallowed" } } }).success).toBe(false);

    const ma = createMaWorkbenchService({ dbPath });
    try {
      ma.admit(sourceKey, "ma", { requestId: randomUUID(), expectedSourceVersion: 1 });
      ma.saveAssessment(sourceKey, "ma", { requestId: randomUUID(), expectedSourceVersion: 1, expectedVersion: 0, categoryMode: "STANDARD",
        primaryCategoryCode: result.output.primaryCategoryCode, secondaryCategoryCode: result.output.secondaryCategoryCode, riskLevel: result.output.riskLevel,
        conclusion: result.output.reasoningBasis[0]!.statement, adoptionMode: "DIRECT" });
      const eventId = ma.submit(sourceKey, "ma", { requestId: randomUUID(), expectedSourceVersion: 1, expectedAssessmentVersion: 1 }).event!.id;
      seed({ HOW: "后续补充的新推送路径", "软件版本": "11.0.0" });
      const sourceStore = createQualitySourceAssessmentService({ dbPath });
      try {
        expect(sourceStore.getLatestAiAssessment(sourceKey)?.sourceSnapshot.rawSnapshot.HOW).toBe(facts.HOW);
        expect(sourceStore.getSourceSnapshot(sourceKey)?.sourceVersion).toBe(2);
      } finally { sourceStore.close(); }
      const db = new DatabaseSync(dbPath);
      try {
        const frozen = db.prepare("SELECT source_snapshots_json FROM quality_event_reporting_snapshots WHERE event_id=?").get(eventId) as { source_snapshots_json: string };
        const original = JSON.parse(frozen.source_snapshots_json)[0];
        expect(original.sourceVersion).toBe(1);
        expect(original.rawSnapshot).toMatchObject(facts);
        expect(original.normalizedSnapshot).toMatchObject({ softwareVersion: "10.4.2", reproduction: facts.HOW, hospital: facts.WHERE, occurredAt: facts.WHEN, occurrenceCount: "3", damagedCount: "1", returned: "是" });
        const link = db.prepare("SELECT source_snapshot_json FROM quality_event_source_links WHERE event_id=?").get(eventId) as { source_snapshot_json: string };
        expect(JSON.parse(link.source_snapshot_json).HOW).toBe(facts.HOW);
      } finally { db.close(); }
    } finally { ma.close(); }
  });

  it("旧表格来源不新增OA上下文，保持原有提示词事实结构", () => {
    const old = prepareAiOriginalAssessmentV0();
    const normalizedFeedback = { ...old.normalizedFeedback, rawSnapshot: { ...facts } };
    const prepared = prepareAiOriginalAssessmentV0FromNormalizedFeedback({ normalizedFeedback, requestId: "legacy-check" });
    expect(prepared.input.sourceSnapshot).not.toHaveProperty("oaContext");
    expect(JSON.stringify(buildAiOriginalAssessmentV0Messages({ assessmentInput: prepared.input }))).not.toContain(facts.HOW);
  });

  it("不把损坏附件JSON、裸链接或未允许的身份字段当作附件内容发送", () => {
    const old = prepareAiOriginalAssessmentV0();
    const prepared = prepareAiOriginalAssessmentV0FromNormalizedFeedback({ requestId: "malformed-files", normalizedFeedback: {
      ...old.normalizedFeedback, sourceKey, rawSnapshot: { ...facts, "上传问题记录图片及视频": "https://files.invalid/?token=private-token", "服务日志导出并上传": "{bad json" },
    } });
    expect(prepared.input.sourceSnapshot.oaContext?.attachments).toEqual([]);
    expect(prepared.input.sourceSnapshot.oaContext?.attachmentContent).toBe("NOT_ANALYZED");
    expect(JSON.stringify(prepared.input.sourceSnapshot.oaContext)).not.toContain("private-");
  });
});
