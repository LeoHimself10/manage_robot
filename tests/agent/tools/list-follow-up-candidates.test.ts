import { describe, expect, it } from "vitest";
import { buildListFollowUpCandidatesHandler } from "../../../src/agent/tools/list-follow-up-candidates";

describe("list_follow_up_candidates tool", () => {
  it("requires trusted actor", async () => {
    const handler = buildListFollowUpCandidatesHandler({
      taskStore: {
        listActiveSubtasksForReminders: () => [],
      } as never,
    });
    const out = await handler({});
    expect(out).toMatchObject({ ok: false, error: "trusted_actor_required" });
  });
});
