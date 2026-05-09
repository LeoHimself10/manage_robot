import { describe, expect, it } from "vitest";
import { buildSearchWebHandler } from "../../../src/agent/tools/search-web";

describe("search_web", () => {
  it("returns note for empty query", async () => {
    const handler = buildSearchWebHandler();
    const result: any = await handler({ query: "" });
    expect(result).toEqual({ results: [], note: "空查询" });
  });
});
