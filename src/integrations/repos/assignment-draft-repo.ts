import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

export function createAssignmentDraftRepo(draftDir: string) {
  return {
    save(draft: { planId: string; traceId: string; promptVersion: string }): void {
      mkdirSync(draftDir, { recursive: true });
      const file = join(draftDir, `${draft.planId}.assignment.json`);
      const tmp = file + ".tmp";
      writeFileSync(tmp, JSON.stringify(draft, null, 2), "utf8");
      renameSync(tmp, file);
    },
    load(planId: string): Record<string, unknown> | undefined {
      try {
        const file = join(draftDir, `${planId}.assignment.json`);
        if (!existsSync(file)) return undefined;
        return JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
      } catch {
        return undefined;
      }
    },
  };
}
