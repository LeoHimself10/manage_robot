export function resolveWorkbenchDynamicManagersPath(): string {
  return process.env.WORKBENCH_DYNAMIC_MANAGER_IDS_FILE?.trim() || "./data/workbench-managers.json";
}
