import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const generateQueryEmbeddingMock = vi.fn<(query: string) => Promise<number[] | null>>();
const searchWithEmbeddingMock = vi.fn<
  (queryEmbedding: number[], topK?: number) => Array<{ traceId: string; summary: string; score: number }>
>();

vi.mock("../../../src/infra/plan-index", () => ({
  generateQueryEmbedding: (q: string) => generateQueryEmbeddingMock(q),
  searchWithEmbedding: (vec: number[], topK?: number) =>
    searchWithEmbeddingMock(vec, topK),
}));

import { buildSearchSimilarPlansHandler } from "../../../src/agent/tools/search-similar-plans";

describe("buildSearchSimilarPlansHandler", () => {
  beforeEach(() => {
    generateQueryEmbeddingMock.mockReset();
    searchWithEmbeddingMock.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns empty_query hint when query is empty", async () => {
    const handler = buildSearchSimilarPlansHandler();
    const result = (await handler({ query: "" })) as {
      results: unknown[];
      hint?: string;
    };
    expect(result.results).toEqual([]);
    expect(result.hint).toBe("empty_query_provide_keywords_first");
    expect(generateQueryEmbeddingMock).not.toHaveBeenCalled();
  });

  it("returns embedding_api_unavailable hint when embedding generation fails", async () => {
    generateQueryEmbeddingMock.mockResolvedValueOnce(null);
    const handler = buildSearchSimilarPlansHandler();
    const result = (await handler({ query: "OCT 焊点客诉" })) as {
      results: unknown[];
      hint?: string;
    };
    expect(result.results).toEqual([]);
    expect(result.hint).toBe(
      "embedding_api_unavailable_do_not_retry_same_query",
    );
    expect(searchWithEmbeddingMock).not.toHaveBeenCalled();
  });

  it("returns no_match hint when index returns 0 results", async () => {
    generateQueryEmbeddingMock.mockResolvedValueOnce([0.1, 0.2, 0.3]);
    searchWithEmbeddingMock.mockReturnValueOnce([]);
    const handler = buildSearchSimilarPlansHandler();
    const result = (await handler({ query: "OCT 焊点客诉" })) as {
      results: unknown[];
      hint?: string;
    };
    expect(result.results).toEqual([]);
    expect(result.hint).toBe("no_match_in_plan_index_do_not_retry_same_query");
  });

  it("returns results without hint when matches exist", async () => {
    generateQueryEmbeddingMock.mockResolvedValueOnce([0.1, 0.2, 0.3]);
    searchWithEmbeddingMock.mockReturnValueOnce([
      { traceId: "trace-1", summary: "类似案例1", score: 0.92 },
      { traceId: "trace-2", summary: "类似案例2", score: 0.85 },
    ]);
    const handler = buildSearchSimilarPlansHandler();
    const result = (await handler({ query: "OCT 焊点客诉" })) as {
      results: Array<{ traceId: string }>;
      hint?: string;
      query?: string;
    };
    expect(result.results).toHaveLength(2);
    expect(result.results[0]?.traceId).toBe("trace-1");
    expect(result.hint).toBeUndefined();
    expect(result.query).toBe("OCT 焊点客诉");
  });
});
