import type { QualitySourceSheet } from "../source/quality-source-schema";
import type { AiOriginalAssessmentInput } from "./ai-original-assessment-contracts";
import {
  HISTORICAL_FEEDBACK_TAXONOMY_V0,
  HISTORICAL_FEEDBACK_TAXONOMY_VERSION,
} from "./historical-feedback-taxonomy-v0";

export const AI_ORIGINAL_ASSESSMENT_V0_PROMPT_VERSION =
  "quality-ai-original-assessment-prompt-v0.11-handling-enum" as const;
export const AI_ORIGINAL_ASSESSMENT_V0_CATEGORY_DICTIONARY_VERSION =
  HISTORICAL_FEEDBACK_TAXONOMY_VERSION;
export const AI_ORIGINAL_ASSESSMENT_V0_CASE_LIBRARY_VERSION =
  "quality-ai-original-assessment-case-library-v0" as const;
export const AI_ORIGINAL_ASSESSMENT_V0_MODEL_CONFIG_ID =
  "qwen-dashscope-no-tools-v0" as const;
export const AI_ORIGINAL_ASSESSMENT_V0_REQUEST_ID =
  "REQ-AI-ASSESSMENT-V0-DEMO-001" as const;

export const V0_CATEGORY_DICTIONARY = HISTORICAL_FEEDBACK_TAXONOMY_V0;

export const V0_DEMO_HISTORICAL_CASES: AiOriginalAssessmentInput["retrievedCases"] = [
  {
    caseId: "CASE-TEST-001",
    title: "脱敏案例：导管轴体弯折",
    summary: "某型号导管在模拟操作中轴体中段出现弯折，复核后按质量问题处理。",
    primaryCategoryCode: "CATHETER_PRODUCT",
    secondaryCategoryCode: "CATHETER_BEND_SHAKE",
    riskLevel: "HIGH",
    outcome: "完成人工复核并建立质量事件。",
    sourceReference: "test-case-library/CASE-TEST-001",
  },
  {
    caseId: "CASE-TEST-002",
    title: "脱敏案例：图像偏暗",
    summary: "测试设备出现图像偏暗，补充连接记录后确认需要现场排查。",
    primaryCategoryCode: "IMAGING_OPTICS",
    secondaryCategoryCode: "IMAGE_DARK",
    riskLevel: "MEDIUM",
    outcome: "补充资料后安排工程师检查。",
    sourceReference: "test-case-library/CASE-TEST-002",
  },
  {
    caseId: "CASE-TEST-003",
    title: "脱敏案例：现场操作咨询",
    summary: "首次使用时对界面操作有疑问，培训后未再出现。",
    primaryCategoryCode: "OPERATION_SERVICE",
    secondaryCategoryCode: "OPERATION_USE_LOAD",
    riskLevel: "LOW",
    outcome: "按普通反馈关闭并补充培训记录。",
    sourceReference: "test-case-library/CASE-TEST-003",
  },
];

export const V0_DEMO_SOURCE_SHEET: QualitySourceSheet = {
  sheetId: "sheet-ai-assessment-v0-demo",
  sheetName: "AI原始研判V0完全脱敏假反馈",
  rows: [
    [
      "反馈时间",
      "反馈单号",
      "反馈人员",
      "设备型号",
      "设备序列号",
      "报损导管批次",
      "问题描述",
      "术者是否可以感知",
      "对术者造成的影响",
      "确认情况",
      "问题归类",
    ],
    [
      "2026-08-20 09:00:00",
      "FB-V0-DEMO-001",
      "脱敏测试人员",
      "测试型号-A",
      "SN-DEMO-0001",
      "BATCH-DEMO-01",
      "模拟台架测试中导管轴体中段出现明显弯折，导致无法继续推送，测试操作被暂停。",
      "测试人员可以感知",
      "仅影响模拟测试，无真实患者和医疗操作",
      "完全脱敏假数据，无需联系真实人员",
      "弯折",
    ],
  ],
};
