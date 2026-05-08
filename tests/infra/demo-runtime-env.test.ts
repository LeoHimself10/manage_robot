import { afterEach, describe, expect, it, vi } from "vitest";
import {
  readDemoLlmCorrectionEnabled,
  readSessionDigestMaxChars,
} from "../../src/infra/demo-runtime-env";

describe("demo-runtime-env", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("readDemoLlmCorrectionEnabled defaults true", () => {
    vi.stubEnv("DEMO_LLM_CORRECTION", undefined);
    expect(readDemoLlmCorrectionEnabled()).toBe(true);
  });

  it("readDemoLlmCorrectionEnabled false for 0 false no", () => {
    vi.stubEnv("DEMO_LLM_CORRECTION", "0");
    expect(readDemoLlmCorrectionEnabled()).toBe(false);
    vi.stubEnv("DEMO_LLM_CORRECTION", "false");
    expect(readDemoLlmCorrectionEnabled()).toBe(false);
    vi.stubEnv("DEMO_LLM_CORRECTION", "no");
    expect(readDemoLlmCorrectionEnabled()).toBe(false);
  });

  it("readSessionDigestMaxChars defaults and clamps", () => {
    vi.stubEnv("SESSION_DIGEST_MAX_CHARS", undefined);
    expect(readSessionDigestMaxChars()).toBe(2000);
    vi.stubEnv("SESSION_DIGEST_MAX_CHARS", "800");
    expect(readSessionDigestMaxChars()).toBe(800);
    vi.stubEnv("SESSION_DIGEST_MAX_CHARS", "12000");
    expect(readSessionDigestMaxChars()).toBe(8000);
    vi.stubEnv("SESSION_DIGEST_MAX_CHARS", "100");
    expect(readSessionDigestMaxChars()).toBe(2000);
    vi.stubEnv("SESSION_DIGEST_MAX_CHARS", "not-a-number");
    expect(readSessionDigestMaxChars()).toBe(2000);
  });
});
