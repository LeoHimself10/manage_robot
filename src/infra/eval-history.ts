import { join } from "node:path";

export function resolveEvalHistoryDir(): string {
  return process.env.EVAL_HISTORY_DIR?.trim() || join(process.cwd(), "data/eval-history");
}

export function resolveEvalHistoryPath(): string {
  return join(resolveEvalHistoryDir(), "eval-runs.jsonl");
}
