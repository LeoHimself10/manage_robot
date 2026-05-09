import { mkdirSync, readFileSync, readdirSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import { resolvePlanStoreDir } from "./plan-store";

interface PlanEmbedding {
  traceId: string;
  embedding: number[];
  summary: string;
  createdAt: string;
}

export function savePlanEmbedding(traceId: string, summary: string, embedding: number[]): void {
  if (process.env.PLAN_EMBEDDING_DISABLED === "1") return;
  try {
    const dir = resolvePlanStoreDir();
    mkdirSync(dir, { recursive: true });
    const record: PlanEmbedding = { traceId, embedding, summary, createdAt: new Date().toISOString() };
    writeFileSync(join(dir, `${traceId}.embedding.json`), JSON.stringify(record), "utf8");
  } catch (err) {
    console.error("[plan-index] save embedding failed:", err instanceof Error ? err.message : String(err));
  }
}

export async function generateQueryEmbedding(query: string): Promise<number[] | null> {
  const apiKey = process.env.DASHSCOPE_API_KEY || process.env.QWEN_API_KEY;
  if (!apiKey) return null;
  try {
    const resp = await fetch("https://dashscope.aliyuncs.com/api/v1/services/embeddings/text-embedding/text-embedding", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model: "text-embedding-v3", input: { texts: [query] } }),
    });
    const data = await resp.json() as Record<string, unknown>;
    const output = (data as Record<string, unknown>).output as Record<string, unknown> | undefined;
    const embeddings = output?.embeddings as Array<{ text_index: number; embedding: number[] }> | undefined;
    return embeddings?.[0]?.embedding ?? null;
  } catch (err) {
    console.error("[plan-index] embedding API error:", err instanceof Error ? err.message : String(err));
    return null;
  }
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

export function searchWithEmbedding(queryEmbedding: number[], topK = 3): Array<{ traceId: string; summary: string; score: number }> {
  const dir = resolvePlanStoreDir();
  if (!existsSync(dir)) return [];
  const files = readdirSync(dir).filter(f => f.endsWith(".embedding.json"));
  if (files.length === 0) return [];

  const results: Array<{ traceId: string; summary: string; score: number }> = [];
  for (const file of files) {
    try {
      const record = JSON.parse(readFileSync(join(dir, file), "utf8")) as PlanEmbedding;
      if (!record.embedding || record.embedding.length === 0) continue;
      const score = cosineSimilarity(queryEmbedding, record.embedding);
      if (score > 0.5) {
        results.push({ traceId: record.traceId, summary: record.summary, score: Math.round(score * 100) / 100 });
      }
    } catch { /* skip corrupt */ }
  }
  results.sort((a, b) => b.score - a.score);
  return results.slice(0, topK);
}
