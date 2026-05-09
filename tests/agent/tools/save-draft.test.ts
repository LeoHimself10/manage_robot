import { describe, expect, it } from "vitest";
import { buildSaveDraftHandler } from "../../../src/agent/tools/save-draft";

describe("save_draft", () => {
  it("returns saved=true for valid minimal draft", async () => {
    const handler = buildSaveDraftHandler();
    const result: any = await handler({
      classification: { domain: "QUALITY", subtype: "PRODUCTION_PROCESS_ABNORMALITY", confidence: "HIGH", rationale: ["test"], missingInformation: [] },
      tasks: [{ id: "t1", title: "task", objective: "do", collaborators: [], inputMaterials: [], actions: [], deliverables: ["d"], completionCriteria: ["c"], timeNode: { checkpoints: [], dueAt: "T+1" }, feedbackFrequency: "daily", risksAndOpenQuestions: [], dependencyTaskIds: [] }],
      capaAdvisory: { advisory: "NOT_REQUIRED", rationale: ["无需CAPA"], disclaimer: "仅为参考", promptingQuestions: [] },
      gateSelfCheck: { passed: true, missingByTask: [] },
    });
    expect(result.saved).toBe(true);
    expect(result.gatePassed).toBe(true);
  });

  it("returns saved=false with errors for empty tasks", async () => {
    const handler = buildSaveDraftHandler();
    const result: any = await handler({
      classification: { domain: "QUALITY", subtype: "PRODUCTION_PROCESS_ABNORMALITY", confidence: "HIGH", rationale: ["test"], missingInformation: [] },
      tasks: [],
      capaAdvisory: { advisory: "NOT_REQUIRED", rationale: ["无需CAPA"], disclaimer: "仅为参考", promptingQuestions: [] },
    });
    expect(result.saved).toBe(false);
    expect((result.errors as string[]).length).toBeGreaterThan(0);
  });
});
