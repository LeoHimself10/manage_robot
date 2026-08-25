import { afterEach, describe, expect, it, vi } from "vitest";

import { resolveQualityCapabilities } from "../../src/security/quality-capabilities";

describe("quality capabilities v2", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("treats quality management as an employee capability, not a business role", () => {
    vi.stubEnv("QUALITY_MANAGEMENT_USER_IDS", "quality-employee");
    vi.stubEnv("QUALITY_SPECIALIST_USER_IDS", "");
    const caps = resolveQualityCapabilities("quality-employee");
    expect(caps.roles).toEqual([]);
    expect(caps.hasQualityManagement).toBe(true);
    expect(caps.canAccessTracking).toBe(true);
  });

  it("keeps legacy specialists compatible during migration", () => {
    vi.stubEnv("QUALITY_SPECIALIST_USER_IDS", "legacy-specialist");
    const caps = resolveQualityCapabilities("legacy-specialist");
    expect(caps.roles).toContain("quality_specialist");
    expect(caps.hasQualityManagement).toBe(true);
  });

  it("does not grant quality management implicitly", () => {
    vi.stubEnv("QUALITY_MANAGEMENT_USER_IDS", "quality-employee");
    vi.stubEnv("QUALITY_SPECIALIST_USER_IDS", "");
    expect(resolveQualityCapabilities("plain-admin").hasQualityManagement).toBe(false);
  });
});
