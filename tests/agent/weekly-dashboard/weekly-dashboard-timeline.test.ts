import { describe, expect, it } from "vitest";
import { computeTaskTimelineBarSpan } from "../../../src/agent/weekly-dashboard/weekly-dashboard-timeline";

describe("weekly dashboard timeline bar span", () => {
  const days = ["2026-05-18", "2026-05-19", "2026-05-20", "2026-05-21", "2026-05-22"];

  it("uses accept date as start and today as end for in-progress work", () => {
    const span = computeTaskTimelineBarSpan({
      status: "IN_PROGRESS",
      days,
      dueYmd: "2026-05-22",
      publishedYmd: "2026-05-18",
      todayYmd: "2026-05-20",
      anchors: { acceptedYmd: "2026-05-19" },
    });
    expect(span).toEqual({
      startDayIndex: 1,
      endDayIndex: 2,
      dueDayIndex: 4,
    });
  });

  it("falls back to publish date when not yet accepted", () => {
    const span = computeTaskTimelineBarSpan({
      status: "ASSIGNED",
      days,
      dueYmd: "2026-05-22",
      publishedYmd: "2026-05-19",
      todayYmd: "2026-05-20",
    });
    expect(span?.startDayIndex).toBe(1);
    expect(span?.endDayIndex).toBe(2);
    expect(span?.dueDayIndex).toBe(4);
  });

  it("uses done date as bar end for completed work", () => {
    const span = computeTaskTimelineBarSpan({
      status: "DONE",
      days,
      dueYmd: "2026-05-22",
      publishedYmd: "2026-05-18",
      todayYmd: "2026-05-21",
      anchors: { acceptedYmd: "2026-05-18", doneYmd: "2026-05-20" },
    });
    expect(span?.startDayIndex).toBe(0);
    expect(span?.endDayIndex).toBe(2);
    expect(span?.dueDayIndex).toBe(4);
  });

  it("keeps dueDayIndex separate from bar end when work finishes early", () => {
    const span = computeTaskTimelineBarSpan({
      status: "DONE",
      days,
      dueYmd: "2026-05-22",
      publishedYmd: "2026-05-18",
      todayYmd: "2026-05-21",
      anchors: { acceptedYmd: "2026-05-19", doneYmd: "2026-05-20" },
    });
    expect(span?.endDayIndex).toBe(2);
    expect(span?.dueDayIndex).toBe(4);
    expect(span!.endDayIndex).toBeLessThan(span!.dueDayIndex);
  });
});
