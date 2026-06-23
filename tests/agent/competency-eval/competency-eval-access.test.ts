import { describe, expect, it, vi, afterEach } from "vitest";
import { isCompetencyEvalEnabled } from "../../../src/agent/competency-eval/competency-eval-flag";
import {
  isCompetencyEvalUser,
  listCompetencyEvalUserIds,
} from "../../../src/agent/competency-eval/competency-eval-access";

describe("competency-eval access", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    delete process.env.COMPETENCY_EVAL_USER_IDS;
    delete process.env.COMPETENCY_EVAL_USER_IDS_FILE;
  });

  it("enabled only when env=1", () => {
    vi.stubEnv("COMPETENCY_EVAL_ENABLED", "1");
    expect(isCompetencyEvalEnabled()).toBe(true);
    vi.stubEnv("COMPETENCY_EVAL_ENABLED", "0");
    expect(isCompetencyEvalEnabled()).toBe(false);
  });

  it("whitelist from env", () => {
    vi.stubEnv("COMPETENCY_EVAL_USER_IDS", "01451725613871,641871342,abc");
    expect(isCompetencyEvalUser("01451725613871")).toBe(true);
    expect(isCompetencyEvalUser("641871342")).toBe(true);
    expect(isCompetencyEvalUser("other")).toBe(false);
    expect(listCompetencyEvalUserIds()).toEqual(["01451725613871", "641871342", "abc"]);
  });
});
