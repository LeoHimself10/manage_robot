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
  assignees: Array<{
    userId: string;
    /**
     * 钉钉 unionId。
     * 创建钉钉原生待办（v1.0/todo/users/{unionId}/tasks）必填；缺失时降级为只发工作消息卡片，
     * 并把"missing unionId"作为 failed 一条记录返回，调用方应将其写入 warnings/EMPLOYEE_NOTIFY_FAILED。
     */
    unionId?: string;
    subtaskTitles: string[];
  }>;
}

export interface WorkbenchNotifyResult {
  enabled: boolean;
  skippedReason?: string;
  success: Array<{
    userId: string;
    /** 工作通知（corpconversation/asyncsend_v2）的 async send task_id，可用 getsendresult 反查投递结果 */
    cardMessageId?: string;
    /** 1:1 机器人主动消息（robot/oToMessages/batchSend）返回的 processQueryKey */
    robotMessageKey?: string;
    /** 钉钉原生待办（todo/users/{unionId}/tasks）的 id */
    todoId?: string;
  }>;
  failed: Array<{ userId: string; reason: string }>;
}

/** 子任务（或整单）改派成功后，通知新负责人（与发布通道一致：卡片 + 机器人 + 可选待办）。 */
export interface WorkbenchReassignNotifyInput {
  taskNo: string;
  taskTitle: string;
  managerUserId: string;
  assigneeUserId: string;
  unionId?: string;
  /** 单子任务改派时有值；整单改派为 undefined */
  subtaskId?: string;
  subtaskTitle?: string;
  scope: "subtask" | "plan";
}

export interface WorkbenchPublishNotifier {
  notifyPublishedTask(input: WorkbenchPublishTaskNotifyInput): Promise<WorkbenchNotifyResult>;
  notifyReassignedAssignee(input: WorkbenchReassignNotifyInput): Promise<WorkbenchNotifyResult>;
}

function env(name: string): string {
  return String(process.env[name] ?? "").trim();
}

function envFlag(name: string, defaultValue: boolean): boolean {
  const raw = env(name).toLowerCase();
  if (raw === "") return defaultValue;
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

function isNotifyEnabled(): boolean {
  return envFlag("WORKBENCH_DINGTALK_NOTIFY_ENABLED", false);
}

function isRobotMsgEnabled(): boolean {
  return envFlag("WORKBENCH_DINGTALK_ROBOT_MSG_ENABLED", true);
}

function resolveRobotCode(): string {
  return env("DINGTALK_ROBOT_CODE") || env("DINGTALK_CLIENT_ID");
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
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok || Number(data.errcode ?? 0) !== 0) {
    throw new Error(`send action card failed: ${res.status} ${JSON.stringify(data)}`);
  }
  return String(data.task_id ?? data.request_id ?? "");
}

/**
 * 通过 `im/v1.0/robot/oToMessages/batchSend` 让机器人在与员工的 **1:1 会话** 里主动发一条 ActionCard。
 * 与 `sendCard`（工作通知/应用消息）属于不同的渠道：
 *   - sendCard 出现在 "工作通知" / 应用消息列表
 *   - sendRobotChatMessage 出现在员工与机器人的对话窗口里（更显眼，员工最容易看到）
 *
 * 前提：
 *   1. 该应用在开放平台 → 应用能力 → 机器人 里启用 "支持机器人主动发起会话"
 *   2. `DINGTALK_ROBOT_CODE` 已配置（Stream 模式下通常等于 DINGTALK_CLIENT_ID）
 *   3. 员工在应用可见范围内
 */
async function sendRobotChatMessage(params: {
  fetchImpl: typeof fetch;
  accessToken: string;
  robotCode: string;
  userId: string;
  title: string;
  markdown: string;
  detailUrl: string;
}): Promise<string | undefined> {
  const res = await params.fetchImpl("https://api.dingtalk.com/v1.0/robot/oToMessages/batchSend", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-acs-dingtalk-access-token": params.accessToken,
    },
    body: JSON.stringify({
      robotCode: params.robotCode,
      userIds: [params.userId],
      msgKey: "sampleActionCard",
      msgParam: JSON.stringify({
        title: params.title,
        text: params.markdown,
        singleTitle: "打开任务详情",
        singleURL: params.detailUrl,
      }),
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`robot oTo send failed: ${res.status} ${text}`);
  }
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return String(data.processQueryKey ?? data.requestId ?? "");
}

function resolveNotifyBaseUrl(): string {
  return (
    env("WORKBENCH_NOTIFY_DETAIL_URL_BASE") ||
    (env("ASSIGNMENT_WEB_PUBLIC_BASE_URL")
      ? `${env("ASSIGNMENT_WEB_PUBLIC_BASE_URL")}/workbench/employee/task`
      : "")
  );
}

async function createTodo(params: {
  fetchImpl: typeof fetch;
  accessToken: string;
  unionId: string;
  sourceId: string;
  subject: string;
  detailUrl: string;
}): Promise<string | undefined> {
  const res = await params.fetchImpl(
    `https://api.dingtalk.com/v1.0/todo/users/${encodeURIComponent(params.unionId)}/tasks`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-acs-dingtalk-access-token": params.accessToken,
      },
      body: JSON.stringify({
        sourceId: params.sourceId,
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
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return String(data.id ?? data.taskId ?? "");
}

export function createWorkbenchPublishNotifier(
  fetchImpl: typeof fetch = fetch,
): WorkbenchPublishNotifier {
  return {
    async notifyPublishedTask(
      input: WorkbenchPublishTaskNotifyInput,
    ): Promise<WorkbenchNotifyResult> {
      if (!isNotifyEnabled()) {
        return {
          enabled: false,
          skippedReason: "WORKBENCH_DINGTALK_NOTIFY_ENABLED is off",
          success: [],
          failed: [],
        };
      }
      const agentId = env("DINGTALK_AGENT_ID") || env("WORKBENCH_DINGTALK_NOTIFY_AGENT_ID");
      const baseUrl = resolveNotifyBaseUrl();
      if (!agentId || !baseUrl) {
        return {
          enabled: false,
          skippedReason: "missing DINGTALK_AGENT_ID or WORKBENCH_NOTIFY_DETAIL_URL_BASE",
          success: [],
          failed: [],
        };
      }
      const robotMsgEnabled = isRobotMsgEnabled();
      const robotCode = resolveRobotCode();
      const token = await getAccessToken(fetchImpl);
      const success: WorkbenchNotifyResult["success"] = [];
      const failed: WorkbenchNotifyResult["failed"] = [];
      for (const assignee of input.assignees) {
        const detailUrl = `${baseUrl}?taskNo=${encodeURIComponent(input.taskNo)}`;
        const subject = `[${input.taskNo}] ${input.title}`;
        const markdown = `### ${subject}\n- 负责人：${assignee.userId}\n- 子任务数：${assignee.subtaskTitles.length}\n- 发布人：${input.managerUserId}`;

        const userOutcome: WorkbenchNotifyResult["success"][number] = { userId: assignee.userId };
        let anyChannelOk = false;

        // 通道 1：工作通知（应用消息）
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
          userOutcome.cardMessageId = cardMessageId;
          anyChannelOk = true;
        } catch (err) {
          failed.push({
            userId: assignee.userId,
            reason: `send card failed: ${err instanceof Error ? err.message : String(err)}`,
          });
        }

        // 通道 2：1:1 机器人主动消息（最显眼，员工最容易看到）
        if (robotMsgEnabled) {
          if (!robotCode) {
            failed.push({
              userId: assignee.userId,
              reason: "skip robot chat message: DINGTALK_ROBOT_CODE missing",
            });
          } else {
            try {
              const robotMessageKey = await sendRobotChatMessage({
                fetchImpl,
                accessToken: token,
                robotCode,
                userId: assignee.userId,
                title: subject,
                markdown,
                detailUrl,
              });
              userOutcome.robotMessageKey = robotMessageKey;
              anyChannelOk = true;
            } catch (err) {
              failed.push({
                userId: assignee.userId,
                reason: `robot chat message failed: ${err instanceof Error ? err.message : String(err)}`,
              });
            }
          }
        }

        // 通道 3：钉钉原生待办
        if (!assignee.unionId) {
          failed.push({
            userId: assignee.userId,
            reason: "skip create todo: unionId missing (need contact sync or unionId resolver)",
          });
        } else {
          try {
            const todoId = await createTodo({
              fetchImpl,
              accessToken: token,
              unionId: assignee.unionId,
              sourceId: `workbench:${input.taskNo}:${assignee.userId}`,
              subject,
              detailUrl,
            });
            userOutcome.todoId = todoId;
            anyChannelOk = true;
          } catch (err) {
            failed.push({
              userId: assignee.userId,
              reason: `create todo failed: ${err instanceof Error ? err.message : String(err)}`,
            });
          }
        }

        if (anyChannelOk) {
          success.push(userOutcome);
        }
      }
      return { enabled: true, success, failed };
    },

    async notifyReassignedAssignee(
      input: WorkbenchReassignNotifyInput,
    ): Promise<WorkbenchNotifyResult> {
      if (!isNotifyEnabled()) {
        return {
          enabled: false,
          skippedReason: "WORKBENCH_DINGTALK_NOTIFY_ENABLED is off",
          success: [],
          failed: [],
        };
      }
      const agentId = env("DINGTALK_AGENT_ID") || env("WORKBENCH_DINGTALK_NOTIFY_AGENT_ID");
      const baseUrl = resolveNotifyBaseUrl();
      if (!agentId || !baseUrl) {
        return {
          enabled: false,
          skippedReason: "missing DINGTALK_AGENT_ID or WORKBENCH_NOTIFY_DETAIL_URL_BASE",
          success: [],
          failed: [],
        };
      }
      const detailUrl = `${baseUrl}?taskNo=${encodeURIComponent(input.taskNo)}`;
      const stTitle =
        input.scope === "subtask"
          ? (input.subtaskTitle?.trim() || "子任务")
          : "整单未完成子任务";
      const subject =
        input.scope === "subtask"
          ? `[改派] ${input.taskNo} · ${stTitle}`
          : `[改派] ${input.taskNo} · 整单`;
      const markdown =
        input.scope === "subtask"
          ? `### ${subject}\n- **任务**：${input.taskTitle}\n- **子任务**：${stTitle}\n- **说明**：主管已将上述子任务改派给您，请在员工工作台「新任务」中接受。\n- **主管**：${input.managerUserId}`
          : `### ${subject}\n- **任务**：${input.taskTitle}\n- **说明**：主管已将本任务下**未完成子任务**全部改派给您，请在员工工作台「新任务」中逐项接受。\n- **主管**：${input.managerUserId}`;

      const robotMsgEnabled = isRobotMsgEnabled();
      const robotCode = resolveRobotCode();
      const token = await getAccessToken(fetchImpl);
      const success: WorkbenchNotifyResult["success"] = [];
      const failed: WorkbenchNotifyResult["failed"] = [];
      const uid = input.assigneeUserId;
      const userOutcome: WorkbenchNotifyResult["success"][number] = { userId: uid };
      let anyChannelOk = false;

      try {
        const cardMessageId = await sendCard({
          fetchImpl,
          accessToken: token,
          agentId,
          userId: uid,
          title: subject,
          markdown,
          detailUrl,
        });
        userOutcome.cardMessageId = cardMessageId;
        anyChannelOk = true;
      } catch (err) {
        failed.push({
          userId: uid,
          reason: `send card failed: ${err instanceof Error ? err.message : String(err)}`,
        });
      }

      if (robotMsgEnabled) {
        if (!robotCode) {
          failed.push({
            userId: uid,
            reason: "skip robot chat message: DINGTALK_ROBOT_CODE missing",
          });
        } else {
          try {
            const robotMessageKey = await sendRobotChatMessage({
              fetchImpl,
              accessToken: token,
              robotCode,
              userId: uid,
              title: subject,
              markdown,
              detailUrl,
            });
            userOutcome.robotMessageKey = robotMessageKey;
            anyChannelOk = true;
          } catch (err) {
            failed.push({
              userId: uid,
              reason: `robot chat message failed: ${err instanceof Error ? err.message : String(err)}`,
            });
          }
        }
      }

      const todoKeyPart = (input.subtaskId ?? "plan").replace(/:/g, "-");
      if (!input.unionId) {
        failed.push({
          userId: uid,
          reason: "skip create todo: unionId missing (need contact sync or unionId resolver)",
        });
      } else {
        try {
          const todoId = await createTodo({
            fetchImpl,
            accessToken: token,
            unionId: input.unionId,
            sourceId: `workbench:reassign:${input.taskNo}:${todoKeyPart}`,
            subject,
            detailUrl,
          });
          userOutcome.todoId = todoId;
          anyChannelOk = true;
        } catch (err) {
          failed.push({
            userId: uid,
            reason: `create todo failed: ${err instanceof Error ? err.message : String(err)}`,
          });
        }
      }

      if (anyChannelOk) {
        success.push(userOutcome);
      }
      return { enabled: true, success, failed };
    },
  };
}
