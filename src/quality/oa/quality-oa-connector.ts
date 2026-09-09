/** Reserved DingTalk OA boundary. No external OA calls are enabled in this release. */
export interface OaFormComponent { id?: string; name?: string; componentType?: string; value?: unknown; extValue?: unknown }
export interface OaInstance {
  title?: string; businessId?: string; createTime?: string; finishTime?: string;
  originatorUserId?: string; originatorDeptId?: string; originatorDeptName?: string;
  status?: string; result?: string; formComponentValues?: OaFormComponent[];
  operationRecords?: Array<Record<string, unknown>>; [key: string]: unknown;
}
/** Implement this interface when the enterprise application is ready to connect. */
export interface QualityOaConnector {
  getInstance(processInstanceId: string): Promise<OaInstance>;
  downloadAttachment(input: {processInstanceId: string; fileId: string}): Promise<Buffer>;
}
let connector: QualityOaConnector | undefined;
export function registerQualityOaConnector(value: QualityOaConnector | undefined): void { connector = value; }
export function getQualityOaConnector(): QualityOaConnector | undefined { return connector; }
export function getQualityOaReadiness(_env?: Record<string, string | undefined>) {
  return { connected: Boolean(connector), configured: Boolean(connector), enabled: Boolean(connector),
    message: connector ? "OA 接口已配置" : "钉钉 OA 接口已预留，尚未连接" };
}
