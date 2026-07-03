import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export type WorkbenchManagerGroupStatus = "active" | "inactive";

export interface WorkbenchManagerGroup {
  groupId: string;
  name: string;
  description?: string;
  status: WorkbenchManagerGroupStatus;
  portfolioEnabled: boolean;
  memberUserIds: string[];
  createdAt: string;
  updatedAt: string;
}

interface WorkbenchManagerGroupFile {
  groups: WorkbenchManagerGroup[];
}

interface WorkbenchManagerGroupPatch {
  name?: string;
  description?: string;
  status?: WorkbenchManagerGroupStatus;
  portfolioEnabled?: boolean;
}

export function isWorkbenchManagerGroupsEnabled(): boolean {
  return process.env.WORKBENCH_MANAGER_GROUPS_ENABLED === "1";
}

export function resolveWorkbenchManagerGroupsPath(): string {
  return process.env.WORKBENCH_MANAGER_GROUPS_FILE?.trim() || "./data/workbench-manager-groups.json";
}

function normalizeUserId(userId: string): string {
  return String(userId ?? "").trim();
}

function normalizeOptionalText(value: unknown): string | undefined {
  return String(value ?? "").trim() || undefined;
}

function normalizeStatus(value: unknown): WorkbenchManagerGroupStatus {
  return value === "inactive" ? "inactive" : "active";
}

function normalizeGroup(raw: unknown, now: string): WorkbenchManagerGroup | undefined {
  const obj = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : undefined;
  if (!obj) return undefined;

  const name = String(obj.name ?? "").trim();
  if (!name) return undefined;

  const seen = new Set<string>();
  const memberUserIds = Array.isArray(obj.memberUserIds)
    ? obj.memberUserIds
        .map((id) => normalizeUserId(String(id)))
        .filter((id) => {
          if (!id || seen.has(id)) return false;
          seen.add(id);
          return true;
        })
    : [];

  return {
    groupId: String(obj.groupId ?? "").trim() || `mgrgrp:${randomUUID()}`,
    name,
    description: normalizeOptionalText(obj.description),
    status: normalizeStatus(obj.status),
    portfolioEnabled: obj.portfolioEnabled === true,
    memberUserIds,
    createdAt: String(obj.createdAt ?? "").trim() || now,
    updatedAt: String(obj.updatedAt ?? "").trim() || now,
  };
}

function normalizeGroups(groups: unknown[]): WorkbenchManagerGroup[] {
  const now = new Date().toISOString();
  return groups
    .map((group) => normalizeGroup(group, now))
    .filter((group): group is WorkbenchManagerGroup => Boolean(group));
}

function readManagerGroupFile(): WorkbenchManagerGroupFile {
  const file = resolveWorkbenchManagerGroupsPath();
  if (!existsSync(file)) return { groups: [] };

  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as unknown;
    if (Array.isArray(parsed)) {
      return { groups: normalizeGroups(parsed) };
    }
    if (parsed && typeof parsed === "object" && Array.isArray((parsed as { groups?: unknown }).groups)) {
      return { groups: normalizeGroups((parsed as { groups: unknown[] }).groups) };
    }
  } catch {
    return { groups: [] };
  }

  return { groups: [] };
}

function writeManagerGroupFile(data: WorkbenchManagerGroupFile): void {
  const file = resolveWorkbenchManagerGroupsPath();
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify({ groups: data.groups }, null, 2), "utf8");
}

function findGroupOrThrow(groups: WorkbenchManagerGroup[], groupId: string): WorkbenchManagerGroup {
  const normalizedGroupId = String(groupId ?? "").trim();
  const group = groups.find((item) => item.groupId === normalizedGroupId);
  if (!group) throw new Error("manager group not found");
  return group;
}

function assertUniqueMember(groups: WorkbenchManagerGroup[], targetGroupId: string, userId: string): void {
  for (const group of groups) {
    if (group.groupId !== targetGroupId && group.memberUserIds.includes(userId)) {
      throw new Error(`user already belongs to manager group: ${group.name}`);
    }
  }
}

export function migrateLegacyManagerGroupFile(groups: unknown[]): void {
  writeManagerGroupFile({ groups: normalizeGroups(groups) });
}

export function listWorkbenchManagerGroups(): WorkbenchManagerGroup[] {
  if (!isWorkbenchManagerGroupsEnabled()) return [];
  return readManagerGroupFile().groups;
}

export function listWorkbenchManagerGroupMemberIds(): Set<string> {
  const ids = new Set<string>();
  for (const group of listWorkbenchManagerGroups()) {
    if (group.status !== "active") continue;
    for (const userId of group.memberUserIds) {
      ids.add(userId);
    }
  }
  return ids;
}

export function findWorkbenchManagerGroupForUser(userId: string): WorkbenchManagerGroup | undefined {
  const normalizedUserId = normalizeUserId(userId);
  if (!normalizedUserId) return undefined;
  return listWorkbenchManagerGroups().find(
    (group) => group.status === "active" && group.memberUserIds.includes(normalizedUserId),
  );
}

export function createWorkbenchManagerGroup(input: {
  name: string;
  description?: string;
  portfolioEnabled?: boolean;
}): WorkbenchManagerGroup {
  const name = String(input.name ?? "").trim();
  if (!name) throw new Error("manager group name is required");

  const now = new Date().toISOString();
  const data = readManagerGroupFile();
  const group: WorkbenchManagerGroup = {
    groupId: `mgrgrp:${randomUUID()}`,
    name,
    description: normalizeOptionalText(input.description),
    status: "active",
    portfolioEnabled: input.portfolioEnabled === true,
    memberUserIds: [],
    createdAt: now,
    updatedAt: now,
  };
  data.groups.push(group);
  writeManagerGroupFile(data);
  return group;
}

export function updateWorkbenchManagerGroup(
  groupId: string,
  patch: WorkbenchManagerGroupPatch,
): WorkbenchManagerGroup {
  const data = readManagerGroupFile();
  const group = findGroupOrThrow(data.groups, groupId);

  if (patch.name !== undefined) {
    const name = String(patch.name ?? "").trim();
    if (!name) throw new Error("manager group name is required");
    group.name = name;
  }
  if (patch.description !== undefined) {
    group.description = normalizeOptionalText(patch.description);
  }
  if (patch.status !== undefined) {
    group.status = patch.status;
  }
  if (patch.portfolioEnabled !== undefined) {
    group.portfolioEnabled = patch.portfolioEnabled === true;
  }
  group.updatedAt = new Date().toISOString();
  writeManagerGroupFile(data);
  return group;
}

export function addWorkbenchManagerGroupMember(groupId: string, userId: string): WorkbenchManagerGroup {
  const normalizedUserId = normalizeUserId(userId);
  if (!normalizedUserId) throw new Error("userId is required");

  const data = readManagerGroupFile();
  const group = findGroupOrThrow(data.groups, groupId);
  assertUniqueMember(data.groups, group.groupId, normalizedUserId);

  if (!group.memberUserIds.includes(normalizedUserId)) {
    group.memberUserIds.push(normalizedUserId);
    group.updatedAt = new Date().toISOString();
    writeManagerGroupFile(data);
  }
  return group;
}

export function removeWorkbenchManagerGroupMember(groupId: string, userId: string): WorkbenchManagerGroup {
  const normalizedUserId = normalizeUserId(userId);
  const data = readManagerGroupFile();
  const group = findGroupOrThrow(data.groups, groupId);

  const nextMemberUserIds = group.memberUserIds.filter((id) => id !== normalizedUserId);
  if (nextMemberUserIds.length !== group.memberUserIds.length) {
    group.memberUserIds = nextMemberUserIds;
    group.updatedAt = new Date().toISOString();
    writeManagerGroupFile(data);
  } else {
    writeManagerGroupFile(data);
  }
  return group;
}
