import { describe, expect, it, vi, afterEach } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { isCompetencyEvalEnabled, readCompetencyEvalThinkingEnabled } from "../../../src/agent/competency-eval/competency-eval-flag";
import {
  isCompetencyEvalUser,
  listCompetencyEvalUserIds,
  listManagedCompetencyEvalUserIds,
  setCompetencyEvalUser,
} from "../../../src/agent/competency-eval/competency-eval-access";

describe("competency-eval access", () => {
  let tempDir = "";

  afterEach(() => {
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
    tempDir = "";
    vi.unstubAllEnvs();
    delete process.env.COMPETENCY_EVAL_USER_IDS;
    delete process.env.COMPETENCY_EVAL_USER_IDS_FILE;
    delete process.env.COMPETENCY_EVAL_MANAGED_USER_IDS_FILE;
    delete process.env.COMPETENCY_EVAL_QWEN_THINKING;
  });

  it("thinking defaults on and can be disabled", () => {
    expect(readCompetencyEvalThinkingEnabled()).toBe(true);
    vi.stubEnv("COMPETENCY_EVAL_QWEN_THINKING", "0");
    expect(readCompetencyEvalThinkingEnabled()).toBe(false);
    vi.stubEnv("COMPETENCY_EVAL_QWEN_THINKING", "1");
    expect(readCompetencyEvalThinkingEnabled()).toBe(true);
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

  it("keeps the configured list until an admin first edits it", () => {
    tempDir = mkdtempSync(join(tmpdir(), "competency-access-"));
    const configuredFile = join(tempDir, "configured.json");
    const managedFile = join(tempDir, "managed.json");
    writeFileSync(configuredFile, JSON.stringify(["file-user"]), "utf8");
    vi.stubEnv("COMPETENCY_EVAL_USER_IDS", "env-user");
    vi.stubEnv("COMPETENCY_EVAL_USER_IDS_FILE", configuredFile);
    vi.stubEnv("COMPETENCY_EVAL_MANAGED_USER_IDS_FILE", managedFile);

    expect(listManagedCompetencyEvalUserIds()).toBeUndefined();
    expect(listCompetencyEvalUserIds()).toEqual(["env-user", "file-user"]);

    expect(setCompetencyEvalUser("new-user", true)).toEqual({
      before: false,
      after: true,
      changed: true,
    });
    expect(listCompetencyEvalUserIds()).toEqual([
      "env-user",
      "file-user",
      "new-user",
    ]);
  });

  it("lets an admin remove configured users and persist an empty list", () => {
    tempDir = mkdtempSync(join(tmpdir(), "competency-access-"));
    const managedFile = join(tempDir, "managed.json");
    vi.stubEnv("COMPETENCY_EVAL_USER_IDS", "env-user");
    vi.stubEnv("COMPETENCY_EVAL_MANAGED_USER_IDS_FILE", managedFile);

    expect(setCompetencyEvalUser("env-user", false)).toEqual({
      before: true,
      after: false,
      changed: true,
    });
    expect(JSON.parse(readFileSync(managedFile, "utf8"))).toEqual([]);
    expect(listManagedCompetencyEvalUserIds()).toEqual([]);
    expect(listCompetencyEvalUserIds()).toEqual([]);
    expect(isCompetencyEvalUser("env-user")).toBe(false);
  });
});
