/**
 * 钉钉知识库表格（WORKBOOK）创建与写入。
 * 需应用开通「知识库写」「钉钉表格写」权限，并配置 workspaceId + operatorUnionId。
 */
import { createDingTalkReportClient } from "./dingtalk-report-client";

export interface DailyReportDocConfig {
  workspaceId: string;
  operatorUnionId: string;
  parentNodeId?: string;
}

export interface CreatedWorkbook {
  workbookId: string;
  url: string;
  name: string;
}

function asString(v: unknown): string {
  return v == null ? "" : String(v).trim();
}

export function createDingTalkWorkbookClient(opts?: { fetchImpl?: typeof fetch }) {
  const fetchImpl = opts?.fetchImpl ?? fetch;
  const tokenProvider = createDingTalkReportClient({ fetchImpl });

  async function apiCall<T>(
    appKey: string,
    appSecret: string,
    method: string,
    path: string,
    body?: Record<string, unknown>,
  ): Promise<T> {
    const token = await tokenProvider.getAccessToken(appKey, appSecret);
    const res = await fetchImpl(`https://api.dingtalk.com${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        "x-acs-dingtalk-access-token": token,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = (await res.json().catch(() => ({}))) as T & {
      code?: string;
      message?: string;
    };
    if (!res.ok) {
      throw new Error(`${method} ${path} failed: ${res.status} ${JSON.stringify(data)}`);
    }
    return data;
  }

  async function createWorkbook(
    appKey: string,
    appSecret: string,
    doc: DailyReportDocConfig,
    name: string,
  ): Promise<CreatedWorkbook> {
    const body: Record<string, unknown> = {
      name,
      docType: "WORKBOOK",
      operatorId: doc.operatorUnionId,
    };
    if (doc.parentNodeId) body.parentNodeId = doc.parentNodeId;

    const data = await apiCall<Record<string, unknown>>(
      appKey,
      appSecret,
      "POST",
      `/v1.0/doc/workspaces/${encodeURIComponent(doc.workspaceId)}/docs`,
      body,
    );
    const workbookId = asString(data.nodeId ?? data.dentryUuid ?? data.uuid);
    const url = asString(data.url ?? data.docUrl);
    if (!workbookId || !url) {
      throw new Error(`createWorkbook missing nodeId/url: ${JSON.stringify(data)}`);
    }
    return { workbookId, url, name };
  }

  async function writeSheetValues(
    appKey: string,
    appSecret: string,
    doc: DailyReportDocConfig,
    workbookId: string,
    rows: string[][],
  ): Promise<void> {
    if (rows.length === 0) return;
    const colCount = Math.max(...rows.map((r) => r.length));
    const endCol = String.fromCharCode("A".charCodeAt(0) + colCount - 1);
    const rangeAddress = `A1:${endCol}${rows.length}`;
    await apiCall(
      appKey,
      appSecret,
      "PUT",
      `/v1.0/doc/workbooks/${encodeURIComponent(workbookId)}/sheets/Sheet1/ranges/${rangeAddress}?operatorId=${encodeURIComponent(doc.operatorUnionId)}`,
      { values: rows },
    );
  }

  return { createWorkbook, writeSheetValues };
}

export type DingTalkWorkbookClient = ReturnType<typeof createDingTalkWorkbookClient>;
