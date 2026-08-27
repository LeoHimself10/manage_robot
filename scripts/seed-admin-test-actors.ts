import { DatabaseSync } from "node:sqlite";
import { createPeopleDirectoryStore } from "../src/infra/people-directory-store";
import { resolveWorkbenchSqlitePath } from "../src/infra/workbench-db-path";
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

const db = new DatabaseSync(resolveWorkbenchSqlitePath());
try {
  const tableExists = (tableName: string): boolean => Boolean(
    db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(tableName),
  );
  if (tableExists("quality_events") && tableExists("quality_assignment_nodes")) {
    db.exec("BEGIN IMMEDIATE");
    try {
      db.exec(`
        UPDATE quality_assignment_nodes
        SET assignee_user_id='QUALITY_TEST_MANAGER_001'
        WHERE assignee_user_id='QUALITY_TEST_MANAGER_002'
          AND event_id IN (SELECT id FROM quality_events WHERE is_test=1);

        UPDATE quality_assignment_nodes
        SET requirement=replace(replace(replace(replace(replace(
          requirement,'主管一','测试主管'),'主管二','测试主管'),
          '员工一','测试员工1'),'员工二','测试员工2'),'员工三','测试员工3')
        WHERE event_id IN (SELECT id FROM quality_events WHERE is_test=1);

        UPDATE quality_events
        SET title=replace(replace(replace(replace(replace(
              title,'主管一','测试主管'),'主管二','测试主管'),
              '员工一','测试员工1'),'员工二','测试员工2'),'员工三','测试员工3'),
            problem_status=replace(replace(replace(replace(replace(
              problem_status,'主管一','测试主管'),'主管二','测试主管'),
              '员工一','测试员工1'),'员工二','测试员工2'),'员工三','测试员工3'),
            supplement=replace(replace(replace(replace(replace(
              coalesce(supplement,''),'主管一','测试主管'),'主管二','测试主管'),
              '员工一','测试员工1'),'员工二','测试员工2'),'员工三','测试员工3')
        WHERE is_test=1;
      `);
      if (tableExists("quality_notification_outbox")) {
        db.exec(`
          UPDATE quality_notification_outbox
          SET recipient_user_id='QUALITY_TEST_MANAGER_001'
          WHERE recipient_user_id='QUALITY_TEST_MANAGER_002'
            AND event_id IN (SELECT id FROM quality_events WHERE is_test=1);
        `);
      }
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
} finally {
  db.close();
}
