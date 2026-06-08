import { DatabaseSync } from "node:sqlite";

const dbPath = process.argv[2]?.trim() || "/app/data/workbench/workbench.sqlite";
const nameHint = process.argv[3]?.trim() || "毛";
const db = new DatabaseSync(dbPath);

const contacts = db
  .prepare(
    `SELECT user_id, name, department_names_json, active, position, job_number
     FROM dingtalk_contacts
     WHERE name LIKE ? OR name LIKE ?
     ORDER BY name`,
  )
  .all(`%${nameHint}%`, `%遂宁%`);

const mgrIds = new Set();
for (const line of (process.env.WORKBENCH_MANAGER_USER_IDS || "").split(",")) {
  const id = line.trim();
  if (id) mgrIds.add(id);
}

console.log(
  JSON.stringify(
    {
      nameMatches: contacts,
      note:
        "Employee workbench: anyone in dingtalk_contacts NOT on manager/admin whitelist can login as employee. Task action requires being subtask assignee.",
    },
    null,
    2,
  ),
);
