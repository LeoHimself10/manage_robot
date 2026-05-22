import { logStructured } from "./logger";
import {
  createDingTalkContactClient,
  type DingTalkContactClient,
  type DingTalkContactRecord,
} from "../integrations/dingtalk/dingtalk-contact-client";
import { createPeopleDirectoryStore } from "./people-directory-store";

export interface ContactSyncResult {
  totalContacts: number;
  upsertedContacts: number;
  deactivatedContacts: number;
}

export interface DingTalkContactSyncService {
  runFullSync(): Promise<ContactSyncResult>;
  applyContactEvent(eventPayload: Record<string, unknown>): Promise<ContactSyncResult>;
  startIntervalLoop(): void;
  stopIntervalLoop(): void;
}

function envBool(name: string, fallback = false): boolean {
  const v = String(process.env[name] ?? "").trim().toLowerCase();
  if (!v) return fallback;
  return v === "1" || v === "true" || v === "yes";
}

function envInt(name: string, fallback: number): number {
  const value = Number(String(process.env[name] ?? "").trim());
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function nowIso(): string {
  return new Date().toISOString();
}

function toContactFromEvent(payload: Record<string, unknown>): DingTalkContactRecord | undefined {
  const userId = String(payload.userid ?? payload.userid ?? "").trim();
  if (!userId) return undefined;
  const deptValues = payload.department;
  const deptIds = Array.isArray(deptValues) ? deptValues.map((item) => String(item)) : [];
  return {
    userId,
    unionId: typeof payload.unionid === "string" ? payload.unionid : undefined,
    name: String(payload.name ?? userId),
    departmentIds: deptIds,
    departmentNames: [],
    position:
      typeof payload.title === "string" && payload.title.trim()
        ? (payload.title as string)
        : typeof payload.position === "string"
          ? payload.position
          : undefined,
    jobNumber: typeof payload.jobnumber === "string" ? payload.jobnumber : undefined,
    mobileMasked: undefined,
    emailMasked: undefined,
    active: true,
    isAdmin: Boolean(payload.isAdmin),
    isBoss: Boolean(payload.isBoss),
    isSenior: Boolean(payload.isSenior),
    rawJson: payload,
  };
}

export function createDingTalkContactSyncService(deps?: {
  client?: DingTalkContactClient;
  peopleStore?: ReturnType<typeof createPeopleDirectoryStore>;
}): DingTalkContactSyncService {
  const client = deps?.client ?? createDingTalkContactClient();
  const peopleStore = deps?.peopleStore ?? createPeopleDirectoryStore();
  const intervalMs = envInt("DINGTALK_CONTACT_SYNC_INTERVAL_MS", 30 * 60 * 1000);
  let timer: NodeJS.Timeout | undefined;

  async function runFullSync(): Promise<ContactSyncResult> {
    const startedAt = nowIso();
    try {
      const contacts = await client.listAllEmployees();
      let upserted = 0;
      for (const contact of contacts) {
        peopleStore.upsertContact({
          ...contact,
          lastSyncedAt: nowIso(),
          deletedAt: undefined,
        });
        upserted += 1;
      }
      peopleStore.appendSyncRun({
        mode: "full",
        status: "ok",
        totalContacts: contacts.length,
        upsertedContacts: upserted,
        deactivatedContacts: 0,
        startedAt,
        finishedAt: nowIso(),
      });
      const dupRows = peopleStore.listContacts().reduce<Map<string, string[]>>((acc, c) => {
        if (!c.active) return acc;
        const key = c.name.trim();
        if (!key) return acc;
        const list = acc.get(key) ?? [];
        list.push(c.userId);
        acc.set(key, list);
        return acc;
      }, new Map());
      for (const [name, userIds] of dupRows) {
        if (userIds.length > 1) {
          logStructured({ event: "contact_duplicate_name", name, userIds });
        }
      }
      return { totalContacts: contacts.length, upsertedContacts: upserted, deactivatedContacts: 0 };
    } catch (err) {
      peopleStore.appendSyncRun({
        mode: "full",
        status: "failed",
        totalContacts: 0,
        upsertedContacts: 0,
        deactivatedContacts: 0,
        errorText: err instanceof Error ? err.message : String(err),
        startedAt,
        finishedAt: nowIso(),
      });
      throw err;
    }
  }

  async function applyContactEvent(eventPayload: Record<string, unknown>): Promise<ContactSyncResult> {
    const startedAt = nowIso();
    let upserted = 0;
    let deactivated = 0;
    try {
      const syncAction = String(eventPayload.syncAction ?? "").trim();
      if (syncAction === "user_leave_org") {
        const bizId = String(eventPayload.biz_id ?? eventPayload.bizId ?? "").trim();
        const userId = bizId || String(eventPayload.userid ?? "").trim();
        if (userId) {
          peopleStore.deactivateContact(userId, nowIso());
          deactivated = 1;
        }
      } else {
        const contact = toContactFromEvent(eventPayload);
        if (contact) {
          peopleStore.upsertContact({
            ...contact,
            lastSyncedAt: nowIso(),
            deletedAt: undefined,
          });
          upserted = 1;
        }
      }

      peopleStore.appendSyncRun({
        mode: "event",
        status: "ok",
        totalContacts: upserted + deactivated,
        upsertedContacts: upserted,
        deactivatedContacts: deactivated,
        startedAt,
        finishedAt: nowIso(),
      });
      return {
        totalContacts: upserted + deactivated,
        upsertedContacts: upserted,
        deactivatedContacts: deactivated,
      };
    } catch (err) {
      peopleStore.appendSyncRun({
        mode: "event",
        status: "failed",
        totalContacts: 0,
        upsertedContacts: 0,
        deactivatedContacts: 0,
        errorText: err instanceof Error ? err.message : String(err),
        startedAt,
        finishedAt: nowIso(),
      });
      throw err;
    }
  }

  return {
    runFullSync,
    applyContactEvent,
    startIntervalLoop() {
      if (!envBool("DINGTALK_CONTACT_SYNC_ENABLED", false)) return;
      if (timer) return;
      timer = setInterval(() => {
        void runFullSync().catch(() => {
          // non-fatal background reconciliation failure
        });
      }, intervalMs);
    },
    stopIntervalLoop() {
      if (!timer) return;
      clearInterval(timer);
      timer = undefined;
    },
  };
}
