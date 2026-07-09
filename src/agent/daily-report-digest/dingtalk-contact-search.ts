/**
 * 钉钉通讯录枚举 / 按姓名搜索（用于「日报汇总」名单管理 UI）。
 *
 * - 每个组织用各自企业内部应用的 appKey/appSecret（需「通讯录部门/成员读」权限）。
 * - 钉钉没有「按姓名搜人」的直接接口，这里递归枚举部门（topapi/v2/department/listsub）
 *   再逐部门拉成员（topapi/v2/user/list），在内存按 appKey 缓存目录（默认 5 分钟 TTL），
 *   之后按姓名/userid 子串过滤。首次（或缓存过期后）较慢，命中缓存后即时。
 */
import { createDingTalkReportClient } from "./dingtalk-report-client";
import { withDingTalkRateLimitRetry } from "./dingtalk-rate-limit-retry";

export interface ContactCandidate {
  userid: string;
  name: string;
  departments: string[];
}

interface CachedDirectory {
  builtAt: number;
  users: ContactCandidate[];
}

const DEFAULT_TTL_MS = 15 * 60 * 1000;
const ROOT_DEPT_ID = 1;
const MAX_DEPARTMENTS = 4000;
const USER_PAGE_SIZE = 100;
const MAX_USER_PAGES_PER_DEPT = 500;

interface DingTalkOapiError {
  errcode?: number;
  errmsg?: string;
}

function asString(value: unknown): string {
  return value == null ? "" : String(value).trim();
}

export interface DingTalkContactDirectory {
  search(
    appKey: string,
    appSecret: string,
    query: string,
    limit?: number,
  ): Promise<ContactCandidate[]>;
  /** 枚举组织全部通讯录（空 query）；用于微光 org_all 日报发现。 */
  listAll(appKey: string, appSecret: string, limit?: number): Promise<ContactCandidate[]>;
  /** 强制重建某 appKey 的目录缓存（增删名单后可调用以反映最新通讯录）。 */
  invalidate(appKey: string): void;
}

export function createDingTalkContactDirectory(opts?: {
  fetchImpl?: typeof fetch;
  ttlMs?: number;
}): DingTalkContactDirectory {
  const fetchImpl = opts?.fetchImpl ?? fetch;
  const ttlMs = opts?.ttlMs ?? DEFAULT_TTL_MS;
  const tokenProvider = createDingTalkReportClient({ fetchImpl });
  const cache = new Map<string, CachedDirectory>();
  const inflight = new Map<string, Promise<ContactCandidate[]>>();

  async function callOapi<T>(
    token: string,
    path: string,
    body: Record<string, unknown>,
  ): Promise<T> {
    return withDingTalkRateLimitRetry(async () => {
      const res = await fetchImpl(
        `https://oapi.dingtalk.com/${path}?access_token=${encodeURIComponent(token)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      const data = (await res.json().catch(() => ({}))) as T & DingTalkOapiError;
      if (!res.ok || (typeof data.errcode === "number" && data.errcode !== 0)) {
        throw new Error(
          `${path} failed: ${res.status} ${JSON.stringify({
            errcode: data.errcode,
            errmsg: data.errmsg,
          })}`,
        );
      }
      return data;
    });
  }

  /** 递归枚举全部部门，返回 deptId -> 部门名 映射。 */
  async function enumerateDepartments(token: string): Promise<Map<number, string>> {
    const deptNames = new Map<number, string>();
    deptNames.set(ROOT_DEPT_ID, "");
    const queue: number[] = [ROOT_DEPT_ID];
    while (queue.length > 0 && deptNames.size < MAX_DEPARTMENTS) {
      const deptId = queue.shift() as number;
      const data = await callOapi<{
        result?: Array<{ dept_id?: number; name?: string }>;
      }>(token, "topapi/v2/department/listsub", { dept_id: deptId });
      for (const d of data.result ?? []) {
        const id = Number(d.dept_id);
        if (!Number.isFinite(id) || deptNames.has(id)) continue;
        deptNames.set(id, asString(d.name));
        queue.push(id);
      }
    }
    return deptNames;
  }

  async function enumerateUsers(
    token: string,
    deptNames: Map<number, string>,
  ): Promise<ContactCandidate[]> {
    const byId = new Map<string, ContactCandidate>();
    for (const deptId of deptNames.keys()) {
      let cursor = 0;
      for (let page = 0; page < MAX_USER_PAGES_PER_DEPT; page += 1) {
        const data = await callOapi<{
          result?: {
            list?: Array<Record<string, unknown>>;
            next_cursor?: number;
            has_more?: boolean;
          };
        }>(token, "topapi/v2/user/list", {
          dept_id: deptId,
          cursor,
          size: USER_PAGE_SIZE,
        });
        const list = data.result?.list ?? [];
        for (const u of list) {
          const userid = asString(u.userid);
          if (!userid) continue;
          const name = asString(u.name);
          const deptIdList = Array.isArray(u.dept_id_list)
            ? (u.dept_id_list as unknown[]).map((x) => Number(x)).filter(Number.isFinite)
            : [];
          const deptLabels = deptIdList
            .map((id) => deptNames.get(id) ?? "")
            .filter((s) => s.length > 0);
          const existing = byId.get(userid);
          if (existing) {
            for (const d of deptLabels) {
              if (!existing.departments.includes(d)) existing.departments.push(d);
            }
          } else {
            byId.set(userid, { userid, name, departments: [...new Set(deptLabels)] });
          }
        }
        const hasMore = Boolean(data.result?.has_more);
        const nextCursor = Number(data.result?.next_cursor ?? 0);
        if (!hasMore || list.length === 0) break;
        if (!Number.isFinite(nextCursor) || nextCursor <= cursor) break;
        cursor = nextCursor;
      }
    }
    return [...byId.values()];
  }

  async function getDirectory(
    appKey: string,
    appSecret: string,
  ): Promise<ContactCandidate[]> {
    const cached = cache.get(appKey);
    if (cached && Date.now() - cached.builtAt < ttlMs) return cached.users;
    // 并发去重：预热与首次搜索可能同时触发，复用同一次枚举，避免重复拉通讯录。
    const existing = inflight.get(appKey);
    if (existing) return existing;
    const promise = (async () => {
      const token = await tokenProvider.getAccessToken(appKey, appSecret);
      const deptNames = await enumerateDepartments(token);
      const users = await enumerateUsers(token, deptNames);
      cache.set(appKey, { builtAt: Date.now(), users });
      return users;
    })().finally(() => inflight.delete(appKey));
    inflight.set(appKey, promise);
    return promise;
  }

  return {
    async search(appKey, appSecret, query, limit = 30) {
      if (!appKey || !appSecret) throw new Error("appKey / appSecret is required");
      const users = await getDirectory(appKey, appSecret);
      const q = asString(query).toLowerCase();
      const matched = q
        ? users.filter(
            (u) =>
              u.name.toLowerCase().includes(q) || u.userid.toLowerCase().includes(q),
          )
        : users;
      return matched
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name, "zh-Hans-CN"))
        .slice(0, Math.max(1, limit));
    },
    async listAll(appKey, appSecret, limit = 5000) {
      return this.search(appKey, appSecret, "", limit);
    },
    invalidate(appKey) {
      cache.delete(appKey);
    },
  };
}
