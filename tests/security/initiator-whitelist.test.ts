import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isTaskInitiatorAllowed } from "../../src/security/initiator-whitelist";

describe("isTaskInitiatorAllowed", () => {
  let tmpFile: string | undefined;

  beforeEach(() => {
    // Clean env state before each test to ensure isolation.
    vi.unstubAllEnvs();
    tmpFile = undefined;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    if (tmpFile) {
      try { unlinkSync(tmpFile); } catch { /* ok */ }
    }
  });

  it("allows any userId when no env is set", () => {
    expect(isTaskInitiatorAllowed("anyone")).toBe(true);
    expect(isTaskInitiatorAllowed("someone-else")).toBe(true);
  });

  it("allows listed ids and denies unlisted ones via TASK_INITIATOR_USER_IDS", () => {
    vi.stubEnv("TASK_INITIATOR_USER_IDS", "a,b");
    expect(isTaskInitiatorAllowed("a")).toBe(true);
    expect(isTaskInitiatorAllowed("b")).toBe(true);
    expect(isTaskInitiatorAllowed("c")).toBe(false);
  });

  it("trims whitespace in TASK_INITIATOR_USER_IDS values", () => {
    vi.stubEnv("TASK_INITIATOR_USER_IDS", " a , b ,  c ");
    expect(isTaskInitiatorAllowed("a")).toBe(true);
    expect(isTaskInitiatorAllowed("b")).toBe(true);
    expect(isTaskInitiatorAllowed("c")).toBe(true);
    expect(isTaskInitiatorAllowed(" d ")).toBe(false);
  });

  it("reads allowed ids from TASK_INITIATOR_IDS_FILE", () => {
    tmpFile = join(tmpdir(), `test-initiator-ids-${Date.now()}.json`);
    writeFileSync(tmpFile, JSON.stringify(["x"]), "utf8");

    vi.stubEnv("TASK_INITIATOR_IDS_FILE", tmpFile);
    // Clear TASK_INITIATOR_USER_IDS so file path is used
    vi.stubEnv("TASK_INITIATOR_USER_IDS", "");
    expect(isTaskInitiatorAllowed("x")).toBe(true);
    expect(isTaskInitiatorAllowed("y")).toBe(false);
  });

  it("treats empty TASK_INITIATOR_USER_IDS as allow all (dev-friendly)", () => {
    vi.stubEnv("TASK_INITIATOR_USER_IDS", "");
    expect(isTaskInitiatorAllowed("anyone")).toBe(true);
    expect(isTaskInitiatorAllowed("another")).toBe(true);
  });
});
