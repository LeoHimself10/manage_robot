/**
 * 查询早报表格所需 workspaceId / operatorUnionId。
 * Usage: npx tsx scripts/query-daily-report-doc-ids.ts [operatorUserId]
 */
import { createDingTalkReportClient } from "../src/agent/daily-report-digest/dingtalk-report-client";

const appKey = process.env.DINGTALK_CLIENT_ID ?? "";
const appSecret = process.env.DINGTALK_CLIENT_SECRET ?? "";
const operatorUserId = process.argv[2]?.trim() ?? "";

if (!appKey || !appSecret) {
  console.error("Missing DINGTALK_CLIENT_ID / DINGTALK_CLIENT_SECRET");
  process.exit(1);
}

async function getAccessToken(): Promise<string> {
  const client = createDingTalkReportClient();
  return client.getAccessToken(appKey, appSecret);
}

async function apiGet(path: string, token: string): Promise<unknown> {
  const res = await fetch(`https://api.dingtalk.com${path}`, {
    headers: { "x-acs-dingtalk-access-token": token },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`GET ${path} ${res.status} ${JSON.stringify(data)}`);
  }
  return data;
}

async function apiPostOapi(path: string, token: string, body: Record<string, unknown>): Promise<unknown> {
  const res = await fetch(`https://oapi.dingtalk.com${path}?access_token=${encodeURIComponent(token)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json();
}

async function main(): Promise<void> {
  const token = await getAccessToken();

  let operatorUnionId = "";
  if (operatorUserId) {
    const user = (await apiPostOapi("/topapi/v2/user/get", token, {
      userid: operatorUserId,
    })) as { errcode?: number; result?: { unionid?: string; name?: string } };
    if (user.errcode !== 0) {
      console.error("user/get failed:", user);
      process.exit(1);
    }
    operatorUnionId = String(user.result?.unionid ?? "").trim();
    console.log(`operator: ${user.result?.name ?? operatorUserId} unionId=${operatorUnionId}`);
  } else {
    console.log("Tip: pass operator userid as argv[2] to resolve unionId");
  }

  if (!operatorUnionId) {
    console.error("Need operator unionId (pass userid arg or set manually)");
    process.exit(1);
  }

  const list = (await apiGet(
    `/v1.0/doc/workspaces?operatorId=${encodeURIComponent(operatorUnionId)}`,
    token,
  )) as { workspaces?: Array<{ name?: string; workspaceId?: string; url?: string; role?: string }> };

  const workspaces = list.workspaces ?? [];
  console.log(`\nworkspaces (${workspaces.length}):`);
  for (const ws of workspaces) {
    const marker = (ws.name ?? "").includes("日报") ? " <-- match?" : "";
    console.log(`- ${ws.name} | workspaceId=${ws.workspaceId} | role=${ws.role}${marker}`);
    if (ws.url) console.log(`  url: ${ws.url}`);
  }

  const v2 = (await apiGet(
    `/v2.0/wiki/workspaces?operatorId=${encodeURIComponent(operatorUnionId)}&maxResults=30&withPermissionRole=true`,
    token,
  )) as { workspaces?: Array<{ name?: string; workspaceId?: string; permissionRole?: string }> };

  const v2List = v2.workspaces ?? [];
  if (v2List.length > 0) {
    console.log(`\nv2 workspaces (${v2List.length}):`);
    for (const ws of v2List) {
      const marker = (ws.name ?? "").includes("日报") ? " <-- match?" : "";
      console.log(`- ${ws.name} | workspaceId=${ws.workspaceId} | role=${ws.permissionRole}${marker}`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
