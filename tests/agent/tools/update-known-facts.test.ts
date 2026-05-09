import { describe, expect, it } from "vitest";
import { buildKnownFactsHandlers, type KnownFactsStore } from "../../../src/agent/tools/update-known-facts";

function createStore(): KnownFactsStore {
  const facts: string[] = [];
  return {
    get() { return facts; },
    update(f: string[]) { facts.push(...f); },
  };
}

describe("known facts tools", () => {
  it("list returns empty initially", async () => {
    const store = createStore();
    const { get } = buildKnownFactsHandlers(store);
    const result: any = await get({});
    expect(result).toEqual({ facts: [], count: 0, empty: true });
  });

  it("update then list returns added facts", async () => {
    const store = createStore();
    const { update, get } = buildKnownFactsHandlers(store);
    await update({ facts: ["问题为近期新出现", "使用原厂U盘"] });
    const result: any = await get({});
    expect(result.count).toBe(2);
    expect(result.facts).toContain("使用原厂U盘");
  });
});
