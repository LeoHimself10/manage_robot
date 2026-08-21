import { describe, expect, it } from "vitest";
import {
  createDefaultHistoricalFeedbackCaseRetriever,
  isAttachmentOnlyDescription,
  loadHistoricalFeedbackCaseIndex,
} from "../../src/quality/ai-original-assessment/historical-feedback-case-retriever";
import {
  normalizeQualitySourceSheet,
  type NormalizedQualitySourceRow,
  type QualitySourceSheet,
} from "../../src/quality/source/quality-source-schema";

function normalizeFeedback(input: {
  feedbackNo: string;
  feedbackAt?: string;
  deviceModel?: string;
  issueDescription: string;
}): NormalizedQualitySourceRow {
  const sheet: QualitySourceSheet = {
    sheetId: "retriever-test",
    sheetName: "retriever-test",
    rows: [
      ["反馈时间", "反馈单号", "反馈人员", "设备型号", "问题描述"],
      [
        input.feedbackAt ?? "2026-08-21",
        input.feedbackNo,
        "脱敏测试",
        input.deviceModel ?? "",
        input.issueDescription,
      ],
    ],
  };
  return normalizeQualitySourceSheet(sheet)[0]!;
}

describe("1664条历史反馈本地轻量检索", () => {
  it("加载完整索引并返回不超过3条达到阈值的真实案例", () => {
    const index = loadHistoricalFeedbackCaseIndex();
    const retriever = createDefaultHistoricalFeedbackCaseRetriever();
    const feedback = normalizeFeedback({
      feedbackNo: "NEW-FEEDBACK-001",
      deviceModel: "Mobile",
      issueDescription: "支架植入完成后，回拉图像出现固定亮环伪影。",
    });

    const matches = retriever.retrieveMatches(feedback);

    expect(index.sourceRecordCount).toBe(1664);
    expect(matches.length).toBeGreaterThan(0);
    expect(matches.length).toBeLessThanOrEqual(3);
    expect(matches[0]!.score).toBeGreaterThanOrEqual(0.34);
    expect(matches.some((match) => match.sourceRow === 8)).toBe(true);
    expect(matches.every(
      (match) => match.case.secondaryCategoryCode !== "INSUFFICIENT_INFO"
        && !isAttachmentOnlyDescription(match.case.summary),
    )).toBe(true);
  });

  it("排除当前记录，即使文本和型号完全相同", () => {
    const index = loadHistoricalFeedbackCaseIndex();
    const current = index.records.find((record) => record.sourceRow === 8)!;
    const feedback = normalizeFeedback({
      feedbackNo: "CURRENT-ROW-WITHOUT-RAW-ID",
      feedbackAt: current.feedbackAt,
      deviceModel: current.deviceModel,
      issueDescription: current.issueDescription,
    });

    const matches = createDefaultHistoricalFeedbackCaseRetriever({
      minimumSimilarity: 0,
    }).retrieveMatches(feedback);

    expect(matches.some((match) => match.sourceRow === 8)).toBe(false);
  });

  it("附件名、空描述和没有合适相似案例时返回空数组", () => {
    const retriever = createDefaultHistoricalFeedbackCaseRetriever();
    const attachment = normalizeFeedback({
      feedbackNo: "NEW-ATTACHMENT",
      issueDescription: "1.mp4",
    });
    const unrelated = normalizeFeedback({
      feedbackNo: "NEW-UNRELATED",
      issueDescription: "希望增加一个全新的会议室绿植预约入口。",
    });

    expect(retriever.retrieve(attachment)).toEqual([]);
    expect(retriever.retrieve(unrelated)).toEqual([]);
    expect(isAttachmentOnlyDescription("现场视频.mp4")).toBe(true);
  });
});
