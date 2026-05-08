import { appendFileSync, mkdirSync } from "fs";
import { dirname } from "path";

/** Append one JSON object as a single line (JSONL). Creates parent directories. */
export function appendJsonlLine(
  absoluteOrRelativePath: string,
  record: Record<string, unknown>
): void {
  mkdirSync(dirname(absoluteOrRelativePath), { recursive: true });
  appendFileSync(
    absoluteOrRelativePath,
    `${JSON.stringify(record)}\n`,
    "utf8"
  );
}
