import { createPeopleDirectoryStore } from "../src/infra/people-directory-store";
import { EXTERNAL_CONTACT_SOURCE } from "../src/infra/external-contact";

const EXECUTORS = [
  {
    userId: "ext_wuchuanbin",
    username: "wuchuanbin",
    displayName: "武传宾",
    department: "学术推广与品牌宣传",
  },
  {
    userId: "ext_qu_shaozhi",
    username: "qushaozhi",
    displayName: "曲绍志",
    department: "临床推进",
  },
] as const;

function main() {
  const initialPassword = String(process.env.EXTERNAL_EXECUTOR_INITIAL_PASSWORD ?? "").trim();
  if (!initialPassword) {
    console.error("[seed-external-executors] EXTERNAL_EXECUTOR_INITIAL_PASSWORD is required");
    process.exit(1);
  }
  if (initialPassword.length < 8) {
    console.error("[seed-external-executors] password must be at least 8 characters");
    process.exit(1);
  }

  const store = createPeopleDirectoryStore();
  try {
    for (const row of EXECUTORS) {
      store.upsertContact({
        userId: row.userId,
        name: row.displayName,
        departmentIds: [row.department],
        departmentNames: [row.department],
        position: row.department,
        active: true,
        isAdmin: false,
        isBoss: false,
        isSenior: false,
        rawJson: { source: EXTERNAL_CONTACT_SOURCE },
      });
      const existingAccount = store.getExternalAccountByUserId(row.userId);
      store.upsertExternalAccount({
        userId: row.userId,
        username: row.username,
        displayName: row.displayName,
        enabled: true,
        ...(existingAccount
          ? { passwordHash: existingAccount.passwordHash }
          : { password: initialPassword }),
      });
      console.log(`[seed-external-executors] upserted ${row.displayName} (${row.userId}) username=${row.username}`);
    }
  } finally {
    store.close();
  }
}

main();
