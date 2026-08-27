import { createPeopleDirectoryStore } from "../src/infra/people-directory-store";
import {
  ADMIN_TEST_ACTORS,
  isAdminTestSystemEnabled,
} from "../src/testing/admin-test-actors";

if (!isAdminTestSystemEnabled()) {
  console.log("[admin-test-system] disabled; no test identities seeded");
  process.exit(0);
}

const store = createPeopleDirectoryStore();
try {
  const allowed = new Set(ADMIN_TEST_ACTORS.map((actor) => actor.userId));
  for (const existing of store.listContacts()) {
    if (existing.userId.startsWith("QUALITY_TEST_") && !allowed.has(existing.userId)) {
      store.deactivateContact(existing.userId);
    }
  }

  const syncedAt = new Date().toISOString();
  for (const actor of ADMIN_TEST_ACTORS) {
    store.upsertContact({
      userId: actor.userId,
      name: actor.displayName,
      departmentIds: [actor.departmentId],
      departmentNames: [actor.departmentName],
      position: actor.position,
      active: true,
      isAdmin: false,
      isBoss: actor.workbenchRole === "manager",
      isSenior: actor.workbenchRole === "manager",
      rawJson: {
        source: "isolated-admin-test-system",
        supervisorUserId: actor.supervisorUserId,
        suppressDingTalkDelivery: true,
      },
      lastSyncedAt: syncedAt,
    });
  }
  console.log(`[admin-test-system] seeded ${ADMIN_TEST_ACTORS.length} isolated identities`);
} finally {
  store.close();
}
