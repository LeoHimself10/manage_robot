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

  async function collectDepartmentIds(rootDeptId: number): Promise<number[]> {
    const discovered = new Set<number>([rootDeptId]);
    const queue: number[] = [rootDeptId];
    while (queue.length > 0 && discovered.size < 5000) {
      const current = queue.shift() as number;
      const subs = await listSubDepartments(current);
      for (const sub of subs) {
        if (discovered.has(sub.deptId)) continue;
        discovered.add(sub.deptId);
        queue.push(sub.deptId);
      }
    }
    return Array.from(discovered);
  }

  return {
    async listAllEmployees(): Promise<DingTalkContactRecord[]> {
      const rootDeptIdRaw = env("DINGTALK_CONTACT_ROOT_DEPT_ID") || "1";
      const rootDeptId = Number(rootDeptIdRaw);
      if (!Number.isFinite(rootDeptId) || rootDeptId <= 0) {
        throw new Error(`Invalid DINGTALK_CONTACT_ROOT_DEPT_ID: ${rootDeptIdRaw}`);
      }
      const outByUserId = new Map<string, DingTalkContactRecord>();
      const deptIds = await collectDepartmentIds(rootDeptId);
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
            const next: DingTalkContactRecord = {
              userId,
              unionId: typeof row?.unionid === "string" ? row.unionid : undefined,
              name: String(row?.name ?? userId),
              departmentIds: deptIdStrings,
              // DingTalk user list does not always include department names; keep ids here.
              departmentNames: [],
              position: typeof row?.position === "string" ? row.position : undefined,
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
              outByUserId.set(userId, {
                ...existing,
                ...next,
                departmentIds: mergedDeptIds,
              });
            }
          }
          if (!page.hasMore) break;
          cursor += pageSize;
        }
      }
      return Array.from(outByUserId.values());
    },
  };
}
