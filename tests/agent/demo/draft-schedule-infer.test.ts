import { describe, expect, it } from "vitest";
import { inferDraftTaskStartDates } from "../../../src/agent/demo/draft-schedule-infer";

describe("inferDraftTaskStartDates", () => {
  it("fills startAt for root task from anchor date", () => {
    const out = inferDraftTaskStartDates(
      {
        tasks: [
          { id: "task_1", title: "A", timeNode: { dueAt: "2026-05-25" } },
        ],
      },
      "2026-05-19T08:00:00.000Z",
    );
    const t0 = (out.tasks as Array<Record<string, unknown>>)[0]!;
    expect((t0.timeNode as { startAt?: string }).startAt).toBe("2026-05-19");
  });

  it("chains startAt after dependency dueAt", () => {
    const out = inferDraftTaskStartDates(
      {
        tasks: [
          { id: "task_1", title: "A", timeNode: { startAt: "2026-05-19", dueAt: "2026-05-21" } },
          {
            id: "task_2",
            title: "B",
            dependencyTaskIds: ["task_1"],
            timeNode: { dueAt: "2026-05-25" },
          },
        ],
      },
      "2026-05-19T08:00:00.000Z",
    );
    const tasks = out.tasks as Array<Record<string, unknown>>;
    expect((tasks[1]!.timeNode as { startAt?: string }).startAt).toBe("2026-05-22");
  });

  it("does not overwrite explicit startAt", () => {
    const out = inferDraftTaskStartDates(
      {
        tasks: [
          { id: "task_1", title: "A", timeNode: { startAt: "2026-05-20", dueAt: "2026-05-25" } },
        ],
      },
      "2026-05-19T08:00:00.000Z",
    );
    expect(
      ((out.tasks as Array<Record<string, unknown>>)[0]!.timeNode as { startAt?: string }).startAt,
    ).toBe("2026-05-20");
  });
});
