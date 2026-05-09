import { mkdirSync, appendFileSync } from "node:fs";
import { dirname } from "node:path";

export function createAssignmentEventRepo(eventsPath: string) {
  return {
    append(record: Record<string, unknown>): void {
      mkdirSync(dirname(eventsPath), { recursive: true });
      appendFileSync(eventsPath, JSON.stringify(record) + "\n", "utf8");
    },
  };
}
