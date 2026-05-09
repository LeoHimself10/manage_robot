import { mkdirSync, appendFileSync } from "node:fs";
import { dirname } from "node:path";

export function createAssignmentEventRepo(eventsPath: string) {
  return {
    async append(record: Record<string, unknown>): Promise<void> {
      mkdirSync(dirname(eventsPath), { recursive: true });
      appendFileSync(eventsPath, JSON.stringify(record) + "\n", "utf8");
    },
  };
}
