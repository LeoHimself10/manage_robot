import { logStructured } from "../../infra/logger";

interface AccessTokenResp {
  accessToken?: string;
  access_token?: string;
  expireIn?: number;
  expires_in?: number;
  errcode?: number;
  errmsg?: string;
}

interface UserListResp {
  errcode?: number;
  errmsg?: string;
  result?: {
    hasMore?: boolean;
    list?: Array<{
      userid?: string;
      unionid?: string;
      name?: string;
      department?: number[];
      dept_id_list?: number[];
      mobile?: string;
      email?: string;
      // 实际钉钉 topapi/v2/user/list 返回的是 `title`（员工"职务"），
      // 老接口 / 部分版本字段名是 `position`，二者都兼容。
      title?: string;
      position?: string;
      job_number?: string;
      is_admin?: boolean;
      is_boss?: boolean;
      is_senior?: boolean;
    }>;
  };
}

type DingTalkUserListItem = NonNullable<NonNullable<UserListResp["result"]>["list"]>[number];

interface DepartmentListResp {
  errcode?: number;
  errmsg?: string;
  result?: Array<{
    dept_id?: number;
    parent_id?: number;
    name?: string;
  }>;
}

interface DepartmentGetResp {
  errcode?: number;
  errmsg?: string;
  result?: {
    dept_id?: number;
    name?: string;
  };
}

export interface DingTalkContactRecord {
  userId: string;
  unionId?: string;
  name: string;
  departmentIds: string[];
  departmentNames: string[];
  position?: string;
  jobNumber?: string;
  mobileMasked?: string;
  emailMasked?: string;
  active: boolean;
  isAdmin: boolean;
  isBoss: boolean;
  isSenior: boolean;
  rawJson?: Record<string, unknown>;
}

interface TokenCache {
  token: string;
  expiresAtMs: number;
}

function env(name: string): string {
  return String(process.env[name] ?? "").trim();
}

function maskMobile(v?: string): string | undefined {
  const value = String(v ?? "").trim();
  if (!value) return undefined;
  if (value.length <= 7) return value;
  return `${value.slice(0, 3)}****${value.slice(-4)}`;
}

function maskEmail(v?: string): string | undefined {
  const value = String(v ?? "").trim();
  if (!value || !value.includes("@")) return undefined;
  const [name, host] = value.split("@", 2);
  if (name.length <= 2) return `**@${host}`;
  return `${name.slice(0, 2)}***@${host}`;
}

export interface DingTalkContactClient {
  listAllEmployees(): Promise<DingTalkContactRecord[]>;
}

const UNKNOWN_DEPT = "未知部门";

function resolveDepartmentNames(
  departmentIds: string[],
  deptIdToName: Map<number, string>,
): string[] {
  const uniqueSorted = Array.from(new Set(departmentIds.map((id) => String(id).trim()).filter(Boolean))).sort(
    (a, b) => {
      const na = Number(a);
      const nb = Number(b);
      if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb;
      return a.localeCompare(b);
    },
  );
  return uniqueSorted.map((id) => {
    const num = Number(id);
    const raw = Number.isFinite(num) ? deptIdToName.get(num) : undefined;
    const name = typeof raw === "string" ? raw.trim() : "";
    return name.length > 0 ? name : UNKNOWN_DEPT;
  });
}

export function createDingTalkContactClient(fetchImpl: typeof fetch = fetch): DingTalkContactClient {
  let tokenCache: TokenCache | undefined;

  async function getAccessToken(forceRefresh = false): Promise<string> {
    const appKey = env("DINGTALK_CLIENT_ID");
    const appSecret = env("DINGTALK_CLIENT_SECRET");
    if (!appKey || !appSecret) {
      throw new Error("DINGTALK_CLIENT_ID / DINGTALK_CLIENT_SECRET is required");
    }
    if (!forceRefresh && tokenCache && tokenCache.expiresAtMs > Date.now() + 30_000) {
      return tokenCache.token;
    }
    const res = await fetchImpl("https://api.dingtalk.com/v1.0/oauth2/accessToken", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ appKey, appSecret }),
    });
    const body = (await res.json().catch(() => ({}))) as AccessTokenResp;
    if (!res.ok || (typeof body.errcode === "number" && body.errcode !== 0)) {
      throw new Error(`getAccessToken failed: ${res.status} ${JSON.stringify(body)}`);
    }
    const token = String(body.accessToken ?? body.access_token ?? "").trim();
    const expiresIn = Number(body.expireIn ?? body.expires_in ?? 7200);
    if (!token) throw new Error("DingTalk access token missing");
    tokenCache = {
      token,
      expiresAtMs: Date.now() + Math.max(60, Number.isFinite(expiresIn) ? expiresIn : 7200) * 1000,
    };
    return token;
  }

  async function listDepartmentUsers(
    deptId: number,
    cursor = 0,
    size = 100,
  ): Promise<{ hasMore: boolean; list: DingTalkUserListItem[] }> {
    const token = await getAccessToken(false);
    const res = await fetchImpl(
      `https://oapi.dingtalk.com/topapi/v2/user/list?access_token=${encodeURIComponent(token)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dept_id: deptId,
          cursor,
          size,
          order_field: "entry_asc",
          contain_access_limit: false,
          language: "zh_CN",
        }),
      },
    );
    const body = (await res.json().catch(() => ({}))) as UserListResp;
    if (!res.ok || (typeof body.errcode === "number" && body.errcode !== 0)) {
      throw new Error(`list users failed: ${res.status} ${JSON.stringify(body)}`);
    }
    return {
      hasMore: Boolean(body.result?.hasMore),
      list: (body.result?.list ?? []) as DingTalkUserListItem[],
    };
  }

  async function getDepartment(deptId: number): Promise<{ deptId: number; name?: string } | undefined> {
    const token = await getAccessToken(false);
    const res = await fetchImpl(
      `https://oapi.dingtalk.com/topapi/v2/department/get?access_token=${encodeURIComponent(token)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dept_id: deptId }),
      },
    );
    const body = (await res.json().catch(() => ({}))) as DepartmentGetResp;
    if (!res.ok || (typeof body.errcode === "number" && body.errcode !== 0)) {
      return undefined;
    }
    const id = Number(body.result?.dept_id ?? deptId);
    if (!Number.isFinite(id) || id <= 0) return undefined;
    return {
      deptId: id,
      name: typeof body.result?.name === "string" ? body.result.name : undefined,
    };
  }

  async function listSubDepartments(
    deptId: number,
  ): Promise<Array<{ deptId: number; name?: string; parentId?: number }>> {
    const token = await getAccessToken(false);
    const res = await fetchImpl(
      `https://oapi.dingtalk.com/topapi/v2/department/listsub?access_token=${encodeURIComponent(token)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dept_id: deptId }),
      },
    );
    const body = (await res.json().catch(() => ({}))) as DepartmentListResp;
    if (!res.ok || (typeof body.errcode === "number" && body.errcode !== 0)) {
      throw new Error(`list sub departments failed: ${res.status} ${JSON.stringify(body)}`);
    }
    return (Array.isArray(body.result) ? body.result : [])
      .map((item) => ({
        deptId: Number(item?.dept_id ?? 0),
        name: typeof item?.name === "string" ? item.name : undefined,
        parentId: Number(item?.parent_id ?? 0) || undefined,
      }))
      .filter((item) => Number.isFinite(item.deptId) && item.deptId > 0);
  }

  async function collectDepartmentTree(rootDeptId: number): Promise<{
    deptIds: number[];
    deptIdToName: Map<number, string>;
  }> {
    const idToName = new Map<number, string>();
    const rootMeta = await getDepartment(rootDeptId);
    if (rootMeta?.name?.trim()) idToName.set(rootDeptId, rootMeta.name.trim());

    const discovered = new Set<number>([rootDeptId]);
    const queue: number[] = [rootDeptId];
    while (queue.length > 0 && discovered.size < 5000) {
      const current = queue.shift() as number;
      const subs = await listSubDepartments(current);
      for (const sub of subs) {
        const name = typeof sub.name === "string" && sub.name.trim() ? sub.name.trim() : UNKNOWN_DEPT;
        idToName.set(sub.deptId, name);
        if (!discovered.has(sub.deptId)) {
          discovered.add(sub.deptId);
          queue.push(sub.deptId);
        }
      }
    }
    return { deptIds: Array.from(discovered), deptIdToName: idToName };
  }

  return {
    async listAllEmployees(): Promise<DingTalkContactRecord[]> {
      const rootDeptIdRaw = env("DINGTALK_CONTACT_ROOT_DEPT_ID") || "1";
      const rootDeptId = Number(rootDeptIdRaw);
      if (!Number.isFinite(rootDeptId) || rootDeptId <= 0) {
        throw new Error(`Invalid DINGTALK_CONTACT_ROOT_DEPT_ID: ${rootDeptIdRaw}`);
      }
      const outByUserId = new Map<string, DingTalkContactRecord>();
      const { deptIds, deptIdToName } = await collectDepartmentTree(rootDeptId);
      for (const deptId of deptIds) {
        let cursor = 0;
        const pageSize = 100;
        // DingTalk hasMore + cursor pagination on this endpoint.
        for (let i = 0; i < 200; i++) {
          const page = await listDepartmentUsers(deptId, cursor, pageSize);
          for (const row of page.list ?? []) {
            const userId = String(row?.userid ?? "").trim();
            if (!userId) continue;
            const deptValues = row?.department ?? row?.dept_id_list ?? [];
            const deptIdStrings = Array.isArray(deptValues)
              ? deptValues.map((id) => String(id))
              : [String(deptId)];
            const deptNames = resolveDepartmentNames(deptIdStrings, deptIdToName);
            const next: DingTalkContactRecord = {
              userId,
              unionId: typeof row?.unionid === "string" ? row.unionid : undefined,
              name: String(row?.name ?? userId),
              departmentIds: deptIdStrings,
              departmentNames: deptNames,
              position:
                typeof row?.title === "string" && row.title.trim()
                  ? row.title
                  : typeof row?.position === "string"
                    ? row.position
                    : undefined,
              jobNumber: typeof row?.job_number === "string" ? row.job_number : undefined,
              mobileMasked: maskMobile(typeof row?.mobile === "string" ? row.mobile : undefined),
              emailMasked: maskEmail(typeof row?.email === "string" ? row.email : undefined),
              active: true,
              isAdmin: Boolean(row?.is_admin),
              isBoss: Boolean(row?.is_boss),
              isSenior: Boolean(row?.is_senior),
              rawJson: row as Record<string, unknown>,
            };
            const existing = outByUserId.get(userId);
            if (!existing) {
              outByUserId.set(userId, next);
            } else {
              const mergedDeptIds = Array.from(new Set([...existing.departmentIds, ...next.departmentIds]));
              const mergedNames = resolveDepartmentNames(mergedDeptIds, deptIdToName);
              outByUserId.set(userId, {
                ...existing,
                ...next,
                departmentIds: mergedDeptIds,
                departmentNames: mergedNames,
              });
            }
          }
          if (!page.hasMore) break;
          cursor += pageSize;
        }
      }
      const contacts = Array.from(outByUserId.values());
      let contactsWithMissingDeptName = 0;
      for (const c of contacts) {
        if (
          c.departmentNames.length === 0 ||
          c.departmentNames.every((n) => n === UNKNOWN_DEPT || !String(n).trim())
        ) {
          contactsWithMissingDeptName += 1;
        }
      }
      logStructured({
        event: "dingtalk_contact_list_complete",
        deptMapSize: deptIdToName.size,
        contactsWithMissingDeptName,
        totalContacts: contacts.length,
      });
      return contacts;
    },
  };
}
