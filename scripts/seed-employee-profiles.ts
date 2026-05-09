import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

const fixturePath = process.env.EMPLOYEE_FIXTURE_SOURCE || "fixtures/employees-seed.json";
const targetDir = process.env.EMPLOYEE_PROFILE_DIR || "./data/employees/profiles";

function main() {
  try {
    const raw = JSON.parse(readFileSync(fixturePath, "utf8")) as { profiles: unknown[] };
    mkdirSync(targetDir, { recursive: true });
    for (const profile of raw.profiles) {
      const userId = (profile as Record<string, unknown>).userId as string;
      if (!userId) {
        console.warn("[seed] skipping entry without userId");
        continue;
      }
      writeFileSync(join(targetDir, `${userId}.json`), JSON.stringify(profile, null, 2), "utf8");
      console.log(`[seed] wrote ${userId}.json`);
    }
  } catch (err) {
    console.error("[seed] failed:", err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

main();
