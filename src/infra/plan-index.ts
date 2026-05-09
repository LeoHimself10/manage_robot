// Stub — real implementation will be added in Task 4 (plan-index).

export async function generateQueryEmbedding(_query: string): Promise<number[] | null> {
  return null;
}

export function searchWithEmbedding(_embedding: number[], _topK: number): Array<{ summary: string; score: number }> {
  return [];
}
