import "dotenv/config";

import { pathToFileURL } from "node:url";
import {
  createDingTalkWorkbookClient,
  type DailyReportDocConfig,
  type DingTalkSheetProperties,
} from "../src/agent/daily-report-digest/dingtalk-workbook-client";

const EXPECTED_SHEET_NAME = "客户端问题反馈记录表";
const REQUIRED_HEADERS = ["反馈时间", "问题描述", "问题归类"] as const;

interface QualitySourceProbeClient {
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

export interface QualitySourceProbeResult {
  sheetName: string;
  rowCount: number;
  columnCount: number;
  headers: string[];
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

function requiredEnv(
  env: Record<string, string | undefined>,
  names: string[],
): Record<string, string> {
  const values: Record<string, string> = {};
  const missing: string[] = [];
  for (const name of names) {
    const value = String(env[name] ?? "").trim();
    if (!value) missing.push(name);
    else values[name] = value;
  }
  if (missing.length > 0) {
    throw new Error(`missing required environment variables: ${missing.join(", ")}`);
  }
  return values;
}

export async function runQualitySourceProbe(deps?: {
  env?: Record<string, string | undefined>;
  client?: QualitySourceProbeClient;
  writeLine?: (line: string) => void;
}): Promise<QualitySourceProbeResult> {
  const env = deps?.env ?? process.env;
  const values = requiredEnv(env, [
    "DINGTALK_CLIENT_ID",
    "DINGTALK_CLIENT_SECRET",
    "QUALITY_SOURCE_WORKBOOK_ID",
    "QUALITY_SOURCE_OPERATOR_UNION_ID",
  ]);
  const client = deps?.client ?? createDingTalkWorkbookClient();
  const writeLine = deps?.writeLine ?? ((line: string) => console.info(line));
  const doc: DailyReportDocConfig = {
    workspaceId: String(env.QUALITY_SOURCE_WORKSPACE_ID ?? "quality-source").trim(),
    operatorUnionId: values.QUALITY_SOURCE_OPERATOR_UNION_ID,
  };
  const sheets = await client.listSheets(
    values.DINGTALK_CLIENT_ID,
    values.DINGTALK_CLIENT_SECRET,
    doc,
    values.QUALITY_SOURCE_WORKBOOK_ID,
  );
  const firstSheet = sheets[0];
  if (!firstSheet || firstSheet.name !== EXPECTED_SHEET_NAME) {
    throw new Error(
      `first sheet must be ${EXPECTED_SHEET_NAME}; received ${firstSheet?.name || "none"}`,
    );
  }
  const properties = await client.getSheetProperties(
    values.DINGTALK_CLIENT_ID,
    values.DINGTALK_CLIENT_SECRET,
    doc,
    values.QUALITY_SOURCE_WORKBOOK_ID,
    firstSheet.id,
  );
  if (properties.name !== EXPECTED_SHEET_NAME) {
    throw new Error(`sheet property name mismatch: ${properties.name}`);
  }
  const range = `A1:${columnLetter(properties.lastNonEmptyColumn)}${properties.lastNonEmptyRow + 1}`;
  const rows = await client.readSheetValues(
    values.DINGTALK_CLIENT_ID,
    values.DINGTALK_CLIENT_SECRET,
    doc,
    values.QUALITY_SOURCE_WORKBOOK_ID,
    firstSheet.id,
    range,
  );
  const headers = (rows[0] ?? []).map((value) => String(value ?? "").trim());
  for (const required of REQUIRED_HEADERS) {
    if (!headers.includes(required)) throw new Error(`required header missing: ${required}`);
  }
  const rowCount = rows.slice(1).filter((row) =>
    row.some((cell) => String(cell ?? "").trim().length > 0),
  ).length;
  if (rowCount === 0) throw new Error("quality source contains no data rows");
  const result: QualitySourceProbeResult = {
    sheetName: firstSheet.name,
    rowCount,
    columnCount: headers.length,
    headers,
  };
  writeLine(`工作表：${result.sheetName}`);
  writeLine(`数据规模：${result.rowCount} 行，${result.columnCount} 列`);
  writeLine(`表头：${result.headers.join("、")}`);
  return result;
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (invokedPath === import.meta.url) {
  runQualitySourceProbe().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
