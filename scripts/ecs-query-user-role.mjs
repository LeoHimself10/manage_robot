import { readFileSync, existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const userId = process.argv[2]?.trim() || "624511819";
const dbPath = process.argv[3]?.trim() || "/app/data/workbench/workbench.sqlite";

function loadIdsFromEnv(name, fileEnv) {
  const set = new Set();
  const file = process.env[fileEnv]?.trim();
  if (file && existsSync(file)) {
    try {
      const arr = JSON.parse(readFileSync(file, "utf8"));
      if (Array.isArray(arr)) {
        arr.map((x) => String(x).trim()).filter(Boolean).forEach((id) => set.add(id));
      }
    } catch {
      // ignore
    }
  }
  const raw = process.env[name]?.trim();
  if (raw) {
    raw.split(",").map((s) => s.trim()).filter(Boolean).forEach((id) => set.add(id));
  }
  return set;
}

const admins = loadIdsFromEnv("WORKBENCH_ADMIN_USER_IDS", "WORKBENCH_ADMIN_IDS_FILE");
const managers = loadIdsFromEnv("WORKBENCH_MANAGER_USER_IDS", "WORKBENCH_MANAGER_IDS_FILE");
const managerFile = process.env.WORKBENCH_MANAGER_IDS_FILE?.trim();
if (managerFile && existsSync(managerFile)) {
  try {
    const arr = JSON.parse(readFileSync(managerFile, "utf8"));
    if (Array.isArray(arr)) arr.forEach((id) => managers.add(String(id).trim()));
  } catch {
    // ignore
  }
}
const dynamicMgrFile = process.env.WORKBENCH_DYNAMIC_MANAGER_IDS_FILE?.trim();
if (dynamicMgrFile && existsSync(dynamicMgrFile)) {
  try {
    const arr = JSON.parse(readFileSync(dynamicMgrFile, "utf8"));
    if (Array.isArray(arr)) {
      for (const row of arr) {
        const id = typeof row === "string" ? row : row?.userId;
        if (id) managers.add(String(id).trim());
      }
    }
  } catch {
    // ignore
  }
}

const db = new DatabaseSync(dbPath);
const contact = db
  .prepare("SELECT user_id, name, department_names_json, position, active FROM dingtalk_contacts WHERE user_id = ?")
  .get(userId);
const subs = db
  .prepare(
    `SELECT t.task_no, s.title, s.status, s.updated_at
     FROM subtasks s JOIN tasks t ON t.task_id = s.task_id
     WHERE s.assignee_user_id = ? ORDER BY s.updated_at DESC LIMIT 8`,
  )
  .all(userId);

console.log(
  JSON.stringify(
    {
      userId,
      contact,
      whitelist: {
        isAdmin: admins.has(userId),
        isManager: managers.has(userId),
        resolvedRole: admins.has(userId) ? "admin" : managers.has(userId) ? "manager" : "employee",
      },
      assignedSubtasks: subs,
    },
    null,
    2,
  ),
);
