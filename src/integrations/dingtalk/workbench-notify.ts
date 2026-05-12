interface AccessTokenResp {
  accessToken?: string;
  access_token?: string;
  errcode?: number;
  errmsg?: string;
}

export interface WorkbenchPublishTaskNotifyInput {
  taskNo: string;
  title: string;
  managerUserId: string;
  assignees: Array<{ userId: string; subtaskTitles: string[] }>;
}

export interface WorkbenchNotifyResult {
  enabled: boolean;
  skippedReason?: string;
  success: Array<{ userId: string; cardMessageId?: string; todoId?: string }>;
  failed: Array<{ userId: string; reason: string }>;
}

export interface WorkbenchPublishNotifier {
  notifyPublishedTask(input: WorkbenchPublishTaskNotifyInput): Promise<WorkbenchNotifyResult>;
}

function env(name: string): string {
  return String(process.env[name] ?? "").trim();
}

function isNotifyEnabled(): boolean {
  const raw = env("WORKBENCH_DINGTALK_NOTIFY_ENABLED").toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

async function getAccessToken(fetchImpl: typeof fetch): Promise<string> {
  const appKey = env("DINGTALK_CLIENT_ID");
  const appSecret = env("DINGTALK_CLIENT_SECRET");
  if (!appKey || !appSecret) {
    throw new Error("DINGTALK_CLIENT_ID / DINGTALK_CLIENT_SECRET is required");
  }
  const res = await fetchImpl("https://api.dingtalk.com/v1.0/oauth2/accessToken", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ appKey, appSecret }),
  });
  const data = (await res.json().catch(() => ({}))) as AccessTokenResp;
  if (!res.ok || (typeof data.errcode === "number" && data.errcode !== 0)) {
    throw new Error(`getAccessToken failed: ${res.status} ${JSON.stringify(data)}`);
  }
  const token = String(data.accessToken ?? data.access_token ?? "").trim();
  if (!token) throw new Error("access token missing");
  return token;
}

async function sendCard(params: {
  fetchImpl: typeof fetch;
  accessToken: string;
  agentId: string;
  userId: string;
  title: string;
  markdown: string;
  detailUrl: string;
}): Promise<string | undefined> {
  const res = await params.fetchImpl(
    `https://oapi.dingtalk.com/topapi/message/corpconversation/asyncsend_v2?access_token=${encodeURIComponent(params.accessToken)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        agent_id: Number(params.agentId),
        userid_list: params.userId,
        msg: {
          msgtype: "action_card",
          action_card: {
            title: params.title,
            markdown: params.markdown,
            single_title: "打开任务详情",
            single_url: params.detailUrl,
          },
        },
      }),
    },
  );
  const data = await res.json().catch(() => ({})) as Record<string, unknown>;
  if (!res.ok || Number(data.errcode ?? 0) !== 0) {
    throw new Error(`send action card failed: ${res.status} ${JSON.stringify(data)}`);
  }
  return String(data.task_id ?? data.request_id ?? "");
}

async function createTodo(params: {
  fetchImpl: typeof fetch;
  accessToken: string;
  userId: string;
  subject: string;
  detailUrl: string;
}): Promise<string | undefined> {
  const res = await params.fetchImpl(
    `https://api.dingtalk.com/v1.0/todo/users/${encodeURIComponent(params.userId)}/tasks`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-acs-dingtalk-access-token": params.accessToken,
      },
      body: JSON.stringify({
        sourceId: `workbench:${params.userId}:${Date.now()}`,
        subject: params.subject,
        description: params.subject,
        detailUrl: params.detailUrl,
      }),
    },
  );
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`create todo failed: ${res.status} ${text}`);
  }
  const data = await res.json().catch(() => ({})) as Record<string, unknown>;
  return String(data.id ?? data.taskId ?? "");
}

export function createWorkbenchPublishNotifier(fetchImpl: typeof fetch = fetch): WorkbenchPublishNotifier {
  return {
    async notifyPublishedTask(input: WorkbenchPublishTaskNotifyInput): Promise<WorkbenchNotifyResult> {
      if (!isNotifyEnabled()) {
        return { enabled: false, skippedReason: "WORKBENCH_DINGTALK_NOTIFY_ENABLED is off", success: [], failed: [] };
      }
      const agentId = env("DINGTALK_AGENT_ID") || env("WORKBENCH_DINGTALK_NOTIFY_AGENT_ID");
      const baseUrl = env("WORKBENCH_NOTIFY_DETAIL_URL_BASE")
        || (env("ASSIGNMENT_WEB_PUBLIC_BASE_URL") ? `${env("ASSIGNMENT_WEB_PUBLIC_BASE_URL")}/workbench/employee/task` : "");
      if (!agentId || !baseUrl) {
        return { enabled: false, skippedReason: "missing DINGTALK_AGENT_ID or WORKBENCH_NOTIFY_DETAIL_URL_BASE", success: [], failed: [] };
      }
      const token = await getAccessToken(fetchImpl);
      const success: WorkbenchNotifyResult["success"] = [];
      const failed: WorkbenchNotifyResult["failed"] = [];
      for (const assignee of input.assignees) {
        const detailUrl = `${baseUrl}?taskNo=${encodeURIComponent(input.taskNo)}`;
        const subject = `[${input.taskNo}] ${input.title}`;
        const markdown = `### ${subject}\n- 负责人：${assignee.userId}\n- 子任务数：${assignee.subtaskTitles.length}\n- 发布人：${input.managerUserId}`;
        try {
          const cardMessageId = await sendCard({
            fetchImpl,
            accessToken: token,
            agentId,
            userId: assignee.userId,
            title: subject,
            markdown,
            detailUrl,
          });
          const todoId = await createTodo({
            fetchImpl,
            accessToken: token,
            userId: assignee.userId,
            subject,
            detailUrl,
          });
          success.push({ userId: assignee.userId, cardMessageId, todoId });
        } catch (err) {
          failed.push({
            userId: assignee.userId,
            reason: err instanceof Error ? err.message : String(err),
          });
        }
      }
      return { enabled: true, success, failed };
    },
  };
}
