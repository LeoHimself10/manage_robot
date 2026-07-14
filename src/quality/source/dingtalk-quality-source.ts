import {
  createDingTalkWorkbookClient,
  type DailyReportDocConfig,
  type DingTalkSheetProperties,
} from "../../agent/daily-report-digest/dingtalk-workbook-client";
import type { QualitySourceSheet } from "./quality-source-schema";

const EXPECTED_SHEET_NAME = "客户端问题反馈记录表";

interface ReadonlyWorkbookClient {
  listSheets(
    appKey: string,
    appSecret: string,
    doc: DailyReportDocConfig,
    workbookId: string,
  ): Promise<Array<{ id: string; name: string }>>;
  getSheetProperties(
    appKey: string,
    appSecret: string,
    doc: DailyReportDocConfig,
    workbookId: string,
    sheetId: string,
  ): Promise<DingTalkSheetProperties>;
  readSheetValues(
    appKey: string,
    appSecret: string,
    doc: DailyReportDocConfig,
    workbookId: string,
    sheetId: string,
    rangeAddress: string,
  ): Promise<unknown[][]>;
}

function requiredEnv(
  env: Record<string, string | undefined>,
  name: string,
): string {
  const value = String(env[name] ?? "").trim();
  if (!value) throw new Error(`missing required environment variable: ${name}`);
  return value;
}

function columnLetter(zeroBasedColumn: number): string {
  let current = zeroBasedColumn;
  let result = "";
  while (current >= 0) {
    result = String.fromCharCode(65 + (current % 26)) + result;
    current = Math.floor(current / 26) - 1;
  }
  return result;
}

export function createDingTalkQualitySource(deps?: {
  env?: Record<string, string | undefined>;
  client?: ReadonlyWorkbookClient;
}): { readFirstSheet(): Promise<QualitySourceSheet> } {
  const env = deps?.env ?? process.env;
  const client = deps?.client ?? createDingTalkWorkbookClient();

  return {
    async readFirstSheet(): Promise<QualitySourceSheet> {
      const appKey = requiredEnv(env, "DINGTALK_CLIENT_ID");
      const appSecret = requiredEnv(env, "DINGTALK_CLIENT_SECRET");
      const workbookId = requiredEnv(env, "QUALITY_SOURCE_WORKBOOK_ID");
      const operatorUnionId = requiredEnv(env, "QUALITY_SOURCE_OPERATOR_UNION_ID");
      const doc: DailyReportDocConfig = {
        workspaceId: String(env.QUALITY_SOURCE_WORKSPACE_ID ?? "quality-source").trim(),
        operatorUnionId,
      };
      const sheets = await client.listSheets(appKey, appSecret, doc, workbookId);
      const firstSheet = sheets[0];
      if (!firstSheet || firstSheet.name !== EXPECTED_SHEET_NAME) {
        throw new Error(
          `first sheet must be ${EXPECTED_SHEET_NAME}; received ${firstSheet?.name || "none"}`,
        );
      }
      const properties = await client.getSheetProperties(
        appKey,
        appSecret,
        doc,
        workbookId,
        firstSheet.id,
      );
      const range = `A1:${columnLetter(properties.lastNonEmptyColumn)}${properties.lastNonEmptyRow + 1}`;
      const rows = await client.readSheetValues(
        appKey,
        appSecret,
        doc,
        workbookId,
        firstSheet.id,
        range,
      );
      return { sheetId: firstSheet.id, sheetName: firstSheet.name, rows };
    },
  };
}

