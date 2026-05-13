import { describe, expect, it } from "vitest";
import { buildGetMyProfileHandler } from "../../../src/agent/tools/get-my-profile";

describe("get_my_profile tool", () => {
  it("returns profile and updatedAt", () => {
    const handler = buildGetMyProfileHandler({
      peopleStore: {
        getEmployeeSnapshot: () => ({
          selfProfile: { skillTags: ["JS"], strengths: [], boundaries: [], cases: [], tools: [], availability: {} },
        }),
        getProfile: () => ({ updatedAt: "2026-01-01T00:00:00.000Z" }),
      } as any,
    });
    const result = handler({ actorUserId: "emp-1" }) as any;
    expect(result.ok).toBe(true);
    expect(result.profile.skillTags).toContain("JS");
  });
});
