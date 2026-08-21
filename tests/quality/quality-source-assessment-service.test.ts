import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import type {
  AiOriginalAssessmentInput,
  AiOriginalAssessmentOutput,
} from "../../src/quality/ai-original-assessment/ai-original-assessment-contracts";
import { AiOriginalAssessmentV0RunError } from
  "../../src/quality/ai-original-assessment/ai-original-assessment-v0-runner";
import type {
  AiOriginalAssessmentModelAdapter,
  AiOriginalAssessmentModelRequest,
  AiOriginalAssessmentModelResponse,
} from "../../src/quality/ai-original-assessment/qwen-ai-original-assessment-model";
import { createQualityStore } from "../../src/quality/infra/quality-store";
import { createQualityReadStore } from "../../src/quality/infra/quality-read-store";
import { createQualityEventService } from
  "../../src/quality/events/quality-event-service";
import { runQualitySourceAiAssessment } from
  "../../src/quality/reviews/quality-source-ai-assessment-service";
import {
  createQualitySourceAssessmentService,
  saveQualitySourceAssessmentSchema,
} from "../../src/quality/reviews/quality-source-assessment-service";
import { createQualitySourceSync } from
  "../../src/quality/source/quality-source-sync";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length) rmSync(tempDirs.pop()!, { recursive: true, force: true });
});

async function seedSource(issueDescription = "导管推送时发生明显弯折，操作无法继续") {
  const dir = mkdtempSync(join(tmpdir(), "quality-source-assessment-"));
  tempDirs.push(dir);
  const dbPath = join(dir, "quality.sqlite");
  createQualityStore(dbPath).close();
  const sync = createQualitySourceSync({
    dbPath,
    now: () => "2026-08-21T08:00:00.000Z",
    reader: {
      readFirstSheet: async () => ({
        sheetId: "sheet-real",
        sheetName: "客户端问题反馈记录表",
        rows: [
          ["反馈时间", "反馈单号", "反馈人员", "设备型号", "设备序列号", "报损导管批次", "问题描述", "术者是否可以感知", "对术者造成的影响", "确认情况"],
          ["2026-08-21 09:00", "REAL-001", "脱敏人员", "OCT-M1", "SN-001", "B-001", issueDescription, "可以感知", "操作暂停", "已确认"],
        ],
      }),
    },
  });
  await sync.syncNow();
  sync.close();
  return { dbPath, sourceKey: "feedback:REAL-001", issueDescription };
}

function validOutput(input: AiOriginalAssessmentInput): AiOriginalAssessmentOutput {
  return {
    schemaVersion: "ai-original-assessment-output-v0",
    requestId: input.runMetadata.requestId,
    handlingRecommendation: "QUALITY_ANOMALY",
    primaryCategoryCode: "CATHETER_PRODUCT",
    secondaryCategoryCode: "CATHETER_BEND_SHAKE",
    riskLevel: "HIGH",
    reasoningBasis: [{ statement: "反馈说明导管弯折并导致操作暂停。", citationIds: ["feedback-1"] }],
    similarCases: [],
    missingInformation: [],
    uncertainties: [{ topic: "根因", reason: "仍需实物检查确认。" }],
    citations: [{ citationId: "feedback-1", sourceType: "FEEDBACK", sourceId: input.sourceSnapshot.sourceKey, description: "本次反馈快照" }],
    provenance: {
      modelConfigId: input.runMetadata.modelConfigId,
      promptVersion: input.runMetadata.promptVersion,
      categoryDictionaryVersion: input.categoryDictionary.version,
      caseLibraryVersion: input.runMetadata.caseLibraryVersion,
    },
  };
}

class CaptureModel implements AiOriginalAssessmentModelAdapter {
  request?: AiOriginalAssessmentModelRequest;

  constructor(private readonly transform?: (
    output: AiOriginalAssessmentOutput,
  ) => AiOriginalAssessmentOutput) {}

  async generate(request: AiOriginalAssessmentModelRequest): Promise<AiOriginalAssessmentModelResponse> {
    this.request = request;
    const output = this.transform?.(validOutput(request.input)) ?? validOutput(request.input);
    return {
      payload: output,
      rawContent: JSON.stringify(output),
      messages: [],
      trace: {
        requestId: request.input.runMetadata.requestId,
        model: "offline-test-model",
        tokenUsage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        latencyMs: 0,
      },
      toolCallsExecuted: 0,
    };
  }
}

describe("真实来源单条AI研判", () => {
  it("只凭sourceKey重读数据库来源，并在调用模型前使用真实1664条索引检索0到3条", async () => {
    const seeded = await seedSource("数据库中的真实描述：导管弯折，术中操作暂停");
    const model = new CaptureModel();
    const result = await runQualitySourceAiAssessment({
      dbPath: seeded.dbPath,
      sourceKey: seeded.sourceKey,
      requestId: "api-source-truth",
      model,
    });

    expect(model.request?.input.sourceSnapshot.issueDescription).toBe(seeded.issueDescription);
    expect(model.request?.input.sourceSnapshot.sourceKey).toBe(seeded.sourceKey);
    expect(model.request?.input.retrievedCases.length).toBeGreaterThanOrEqual(0);
    expect(model.request?.input.retrievedCases.length).toBeLessThanOrEqual(3);
    expect(model.request?.input.retrievedCases.every((item) => !item.caseId.startsWith("CASE-TEST-"))).toBe(true);
    expect(result.retrievedCases).toEqual(model.request?.input.retrievedCases);
  });

  it("拒绝非法分类编码和错误父子组合", async () => {
    const seeded = await seedSource();
    const invalidCode = new CaptureModel((output) => ({
      ...output,
      primaryCategoryCode: "INVENTED",
    }));
    await expect(runQualitySourceAiAssessment({
      dbPath: seeded.dbPath,
      sourceKey: seeded.sourceKey,
      model: invalidCode,
    })).rejects.toMatchObject({
      code: "MODEL_OUTPUT_INVALID",
    } satisfies Partial<AiOriginalAssessmentV0RunError>);

    const wrongParent = new CaptureModel((output) => ({
      ...output,
      primaryCategoryCode: "SOFTWARE_DATA",
      secondaryCategoryCode: "CATHETER_BEND_SHAKE",
    }));
    await expect(runQualitySourceAiAssessment({
      dbPath: seeded.dbPath,
      sourceKey: seeded.sourceKey,
      model: wrongParent,
    })).rejects.toMatchObject({ code: "MODEL_OUTPUT_INVALID" });
  });
});

describe("人工研判保存", () => {
  const standardAssessment = {
    handlingRecommendation: "QUALITY_ANOMALY" as const,
    categoryMode: "STANDARD" as const,
    primaryCategoryCode: "CATHETER_PRODUCT",
    secondaryCategoryCode: "CATHETER_BEND_SHAKE",
    customPrimaryCategoryName: null,
    customSecondaryCategoryName: null,
    riskLevel: "MEDIUM" as const,
    conclusion: "人工确认需要继续跟进。",
    adoptionMode: "MANUAL" as const,
    changeReason: null,
    expectedVersion: 0,
  };

  it("校验分类父子关系和修改原因", () => {
    const base = {
      handlingRecommendation: "QUALITY_ANOMALY",
      primaryCategoryCode: "CATHETER_PRODUCT",
      secondaryCategoryCode: "CATHETER_BEND_SHAKE",
      riskLevel: "MEDIUM",
      conclusion: "人工确认需要继续跟进。",
      adoptionMode: "MODIFIED",
      expectedVersion: 0,
    } as const;
    expect(saveQualitySourceAssessmentSchema.safeParse(base).success).toBe(false);
    expect(saveQualitySourceAssessmentSchema.safeParse({
      ...base,
      changeReason: "结合现场复核调整风险。",
      primaryCategoryCode: "SOFTWARE_DATA",
    }).success).toBe(false);
  });

  it("AI失败后仍可人工保存，且不创建质量事件、不改来源状态", async () => {
    const seeded = await seedSource();
    const failingModel: AiOriginalAssessmentModelAdapter = {
      generate: async () => { throw new Error("offline model failure"); },
    };
    await expect(runQualitySourceAiAssessment({
      dbPath: seeded.dbPath,
      sourceKey: seeded.sourceKey,
      model: failingModel,
    })).rejects.toMatchObject({ code: "MODEL_CALL_FAILED" });

    const service = createQualitySourceAssessmentService({ dbPath: seeded.dbPath });
    const saved = service.saveAssessment({
      sourceKey: seeded.sourceKey,
      actorUserId: "after-1",
      assessment: {
        handlingRecommendation: "QUALITY_ANOMALY",
        primaryCategoryCode: "CATHETER_PRODUCT",
        secondaryCategoryCode: "CATHETER_BEND_SHAKE",
        riskLevel: "MEDIUM",
        conclusion: "人工确认按质量异常跟进。",
        adoptionMode: "MANUAL",
        changeReason: null,
        expectedVersion: 0,
      },
    });
    service.close();

    expect(saved.version).toBe(1);
    const db = new DatabaseSync(seeded.dbPath, { readOnly: true });
    expect(Number((db.prepare("SELECT COUNT(*) AS count FROM quality_events").get() as { count: number }).count)).toBe(0);
    expect((db.prepare("SELECT state FROM quality_source_rows WHERE source_key = ?").get(seeded.sourceKey) as { state: string }).state).toBe("ACTIVE");
    db.close();
  });

  it("保存并重新加载标准一级和标准二级分类", async () => {
    const seeded = await seedSource();
    const service = createQualitySourceAssessmentService({ dbPath: seeded.dbPath });
    service.saveAssessment({
      sourceKey: seeded.sourceKey,
      actorUserId: "after-1",
      assessment: standardAssessment,
    });
    const reloaded = service.getAssessment(seeded.sourceKey);
    service.close();

    expect(reloaded).toMatchObject({
      categoryMode: "STANDARD",
      isCustomCategory: false,
      primaryCategoryCode: "CATHETER_PRODUCT",
      secondaryCategoryCode: "CATHETER_BEND_SHAKE",
      categoryDisplayName: "导管本体／弯折、扭曲与旋转异常",
    });
  });

  it("保存并重新加载标准一级和自定义二级分类", async () => {
    const seeded = await seedSource();
    const service = createQualitySourceAssessmentService({ dbPath: seeded.dbPath });
    service.saveAssessment({
      sourceKey: seeded.sourceKey,
      actorUserId: "after-1",
      assessment: {
        ...standardAssessment,
        categoryMode: "CUSTOM_SECONDARY",
        secondaryCategoryCode: null,
        customSecondaryCategoryName: "  特殊旋转阻滞  ",
      },
    });
    const reloaded = service.getAssessment(seeded.sourceKey);
    service.close();

    expect(reloaded).toMatchObject({
      categoryMode: "CUSTOM_SECONDARY",
      isCustomCategory: true,
      primaryCategoryCode: "CATHETER_PRODUCT",
      secondaryCategoryCode: null,
      customSecondaryCategoryName: "特殊旋转阻滞",
      categoryDisplayName: "导管本体／特殊旋转阻滞",
    });
  });

  it("保存并重新加载完全自定义分类，列表和后续质量事件显示人工名称", async () => {
    const seeded = await seedSource();
    const service = createQualitySourceAssessmentService({ dbPath: seeded.dbPath });
    service.saveAssessment({
      sourceKey: seeded.sourceKey,
      actorUserId: "after-1",
      assessment: {
        ...standardAssessment,
        categoryMode: "CUSTOM_FULL",
        primaryCategoryCode: null,
        secondaryCategoryCode: null,
        customPrimaryCategoryName: "  特殊器械兼容问题  ",
      },
    });
    const reloaded = service.getAssessment(seeded.sourceKey);
    service.close();
    expect(reloaded).toMatchObject({
      categoryMode: "CUSTOM_FULL",
      isCustomCategory: true,
      primaryCategoryCode: null,
      secondaryCategoryCode: null,
      customPrimaryCategoryName: "特殊器械兼容问题",
      categoryDisplayName: "特殊器械兼容问题",
    });

    const readStore = createQualityReadStore(seeded.dbPath);
    expect(readStore.listSourceRows({ page: 1, pageSize: 10 }).rows[0]?.assessment)
      .toMatchObject({ categoryDisplayName: "特殊器械兼容问题" });
    readStore.close();

    const eventService = createQualityEventService({ dbPath: seeded.dbPath });
    const draft = eventService.createDraftFromSources({
      actor: { userId: "after-1", role: "aftersales_manager" },
      requestId: "11111111-1111-4111-8111-111111111111",
      sourceKeys: [seeded.sourceKey],
    });
    eventService.close();
    expect(draft.event.initialCategory).toBe("特殊器械兼容问题");
  });

  it("拒绝空白、过长自定义分类和自定义分类直接采纳", () => {
    expect(saveQualitySourceAssessmentSchema.safeParse({
      ...standardAssessment,
      categoryMode: "CUSTOM_SECONDARY",
      secondaryCategoryCode: null,
      customSecondaryCategoryName: "   ",
    }).success).toBe(false);
    expect(saveQualitySourceAssessmentSchema.safeParse({
      ...standardAssessment,
      categoryMode: "CUSTOM_FULL",
      primaryCategoryCode: null,
      secondaryCategoryCode: null,
      customPrimaryCategoryName: "自".repeat(101),
    }).success).toBe(false);
    expect(saveQualitySourceAssessmentSchema.safeParse({
      ...standardAssessment,
      categoryMode: "CUSTOM_FULL",
      primaryCategoryCode: null,
      secondaryCategoryCode: null,
      customPrimaryCategoryName: "特殊器械兼容问题",
      adoptionMode: "DIRECT",
    }).success).toBe(false);
  });
});
