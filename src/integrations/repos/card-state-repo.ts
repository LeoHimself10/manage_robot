import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export function createCardStateRepo(cardDir: string) {
  return {
    upsert(outTrackId: string, obj: Record<string, unknown>): void {
      mkdirSync(cardDir, { recursive: true });
      writeFileSync(
        join(cardDir, `${outTrackId}.json`),
        JSON.stringify(obj, null, 2),
        "utf8",
      );
    },
    get(outTrackId: string): Record<string, unknown> | undefined {
      try {
        return JSON.parse(
          readFileSync(join(cardDir, `${outTrackId}.json`), "utf8"),
        );
      } catch {
        return undefined;
      }
    },
  };
}
