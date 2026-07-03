import { findWorkbenchManagerGroupForUser } from "./workbench-manager-groups";

export interface WorkbenchManagerScope {
  actorUserId: string;
  managerUserId: string;
  managerGroupId?: string;
}

export interface ManagerOwnedObject {
  managerUserId: string;
  managerGroupId?: string;
}

function normalizeId(value: string): string {
  return String(value ?? "").trim();
}

function normalizeOptionalId(value: string | undefined): string | undefined {
  const normalized = String(value ?? "").trim();
  return normalized || undefined;
}

export function resolveWorkbenchManagerScope(actorUserId: string): WorkbenchManagerScope {
  const normalizedActorUserId = normalizeId(actorUserId);
  const group = findWorkbenchManagerGroupForUser(normalizedActorUserId);
  const baseScope = {
    actorUserId: normalizedActorUserId,
    managerUserId: normalizedActorUserId,
  };

  if (!group) return baseScope;
  return {
    ...baseScope,
    managerGroupId: group.groupId,
  };
}

export function canAccessManagerOwnedObject(object: ManagerOwnedObject, scope: WorkbenchManagerScope): boolean {
  const objectManagerUserId = normalizeId(object.managerUserId);
  const scopeManagerUserId = normalizeId(scope.managerUserId);
  const objectGroupId = normalizeOptionalId(object.managerGroupId);
  const scopeGroupId = normalizeOptionalId(scope.managerGroupId);

  // Callers should pass a resolved scope, but missing owner ids must still fail closed.
  if (!objectManagerUserId || !scopeManagerUserId) return false;
  if (objectGroupId && scopeGroupId) return objectGroupId === scopeGroupId;
  if (objectGroupId && !scopeGroupId) return false;
  return objectManagerUserId === scopeManagerUserId;
}

export function managerScopeLabel(scope: WorkbenchManagerScope): string {
  const groupId = normalizeOptionalId(scope.managerGroupId);
  if (groupId) return `group:${groupId}`;
  return `manager:${normalizeId(scope.managerUserId)}`;
}
