/**
 * Smoke: read → resolve_roster_names → set_candidate_pool for 10 real contacts.
 * Usage: node --import tsx scripts/smoke-roster-resolve-10.mjs [path-to-roster.md]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createPeopleDirectoryStore } from "../src/infra/people-directory-store.ts";
import {
  buildReadUploadedRosterTextHandler,
  buildResolveRosterNamesHandler,
  buildSetCandidatePoolHandler,
} from "../src/agent/tools/candidate-pool.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rosterPath =
  process.argv[2] ?? path.join(__dirname, "../fixtures/test-roster-10-real-employees.md");

const EXPECTED = [
  "杨楚榛",
  "杨贺新",
  "陈哲治",
  "陈浩",
  "陈佳",
  "毕鹏",
  "曹杰",
  "曾娜",
  "程晓阳",
  "崔枭",
];

const rosterText = fs.readFileSync(rosterPath, "utf8");
const session = {
  chatKeyHash: "smoke-roster",
  planId: "smoke-plan",
  senderStaffId: "smoke-mgr",
  conversationHistory: [],
  knownFacts: [],
  pendingRosterText: rosterText,
  pendingRosterSource: `file:${path.basename(rosterPath)}`,
};

const peopleStore = createPeopleDirectoryStore();
const getContact = (userId) => peopleStore.getContact(userId);

try {
  const readHandler = buildReadUploadedRosterTextHandler({ currentSession: session });
  const resolveHandler = buildResolveRosterNamesHandler({
    currentSession: session,
    getContact,
  });
  const setPoolHandler = buildSetCandidatePoolHandler({
    currentSession: session,
    getContact,
  });

  const readOut = readHandler({});
  if (!readOut.ok) {
    console.error("read failed:", readOut);
    process.exit(1);
  }

  const resolveOut = resolveHandler({ names: EXPECTED });
  console.log("resolve:", {
    ok: resolveOut.ok,
    resolved: resolveOut.resolved?.length,
    unresolved: resolveOut.unresolved?.length,
    duplicateSkipped: resolveOut.duplicateSkipped,
  });

  if (!resolveOut.ok || resolveOut.resolved?.length !== 10) {
    console.error("resolve detail:", JSON.stringify(resolveOut, null, 2));
    process.exit(1);
  }

  if (resolveOut.unresolved?.length) {
    console.error("unresolved:", resolveOut.unresolved);
    process.exit(1);
  }

  const setOut = setPoolHandler({
    entries: resolveOut.resolved.map((r) => ({
      userId: r.userId,
      displayName: r.displayName,
      fileNotes: r.inputName,
    })),
    source: "smoke:10-real",
  });

  console.log("set_pool:", {
    ok: setOut.ok,
    poolSize: session.candidatePool?.entries?.length,
  });

  if (!setOut.ok || session.candidatePool?.entries?.length !== 10) {
    console.error("set_pool detail:", setOut);
    process.exit(1);
  }

  console.log(
    "PASS: 10/10 resolved and pooled:",
    session.candidatePool.entries.map((e) => e.displayName).join("、"),
  );
} finally {
  peopleStore.close();
}
