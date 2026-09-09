import type { IncomingMessage, ServerResponse } from "node:http";
import { z, ZodError } from "zod";
import type { QualityHttpSession } from "./quality-http";
import { resolveQualityCapabilities } from "../security/quality-capabilities";
import { resolveWorkbenchSqlitePath } from "../infra/workbench-db-path";
import { createMaWorkbenchService, MaWorkbenchError, maAssessmentRequestSchema, maSubmitRequestSchema, maVersionRequestSchema } from "../quality/ma-workbench/service";
import { downloadQualityOaAttachment, listQualityOaAttachments } from "../quality/oa/quality-oa-source";
import { QualitySourceAiAssessmentError } from "../quality/reviews/quality-source-ai-assessment-service";
import { AiOriginalAssessmentV0RunError } from "../quality/ai-original-assessment/ai-original-assessment-v0-runner";

const prefix = "/api/workbench/quality/ma/feedbacks";
export function isQualityMaApiPath(path: string): boolean { return path === prefix || path.startsWith(`${prefix}/`); }
function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" });
  res.end(JSON.stringify(body));
}
async function body(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []; let size = 0;
  for await (const chunk of req) { const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)); size += value.length; if (size > 256 * 1024) throw new Error("request too large"); chunks.push(value); }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}
export async function handleQualityMaApi(input: { req: IncomingMessage; res: ServerResponse; url: URL; session: QualityHttpSession }): Promise<void> {
  const { req, res, url, session } = input;
  if (session.loginSource === "external_password" || !resolveQualityCapabilities(session.userId).canReportQuality) {
    json(res, 403, { ok: false, code: "FORBIDDEN", error: "无马荣鑫工作台业务权限" }); return;
  }
  const dbPath = resolveWorkbenchSqlitePath();
  const service = createMaWorkbenchService({ dbPath, listAttachments: listQualityOaAttachments });
  try {
    if (url.pathname === prefix && req.method === "GET") {
      const query = z.object({ scope: z.enum(["all", "pending", "progress", "closed"]).default("all"), q: z.string().max(500).default(""), page: z.coerce.number().int().positive().default(1), pageSize: z.coerce.number().int().min(1).max(200).default(20) }).parse(Object.fromEntries(url.searchParams));
      json(res, 200, { ok: true, data: service.list(session.userId, query) }); return;
    }
    const match = url.pathname.match(/^\/api\/workbench\/quality\/ma\/feedbacks\/([^/]+)(?:\/(admit|ai|assessment|submit|attachments)(?:\/([^/]+))?)?$/);
    if (!match) { json(res, 404, { ok: false, code: "NOT_FOUND", error: "接口不存在" }); return; }
    const key = decodeURIComponent(match[1]!); const action = match[2];
    if (req.method === "GET" && action === "attachments" && match[3]) {
      service.get(key, session.userId);
      const file = await downloadQualityOaAttachment({ dbPath, sourceKey: key, id: decodeURIComponent(match[3]) });
      const disposition = url.searchParams.get("download") === "1" ? "attachment" : "inline";
      res.writeHead(200, { "Content-Type": file.mimeType, "Content-Length": file.body.length, "Content-Disposition": `${disposition}; filename*=UTF-8''${encodeURIComponent(file.name)}`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "sandbox; default-src 'none'; media-src 'self' blob:; img-src 'self' data: blob:", "Referrer-Policy": "no-referrer" });
      res.end(file.body); return;
    }
    if (req.method === "GET" && !action) { json(res, 200, { ok: true, data: service.get(key, session.userId) }); return; }
    if (req.method !== "POST" || !["admit", "ai", "assessment", "submit"].includes(action ?? "")) { json(res, 405, { ok: false, code: "METHOD_NOT_ALLOWED", error: "该操作不可用" }); return; }
    const value = await body(req);
    const result = action === "admit" ? service.admit(key, session.userId, maVersionRequestSchema.parse(value))
      : action === "ai" ? await service.ai(key, session.userId, maVersionRequestSchema.parse(value))
        : action === "assessment" ? service.saveAssessment(key, session.userId, maAssessmentRequestSchema.parse(value))
          : service.submit(key, session.userId, maSubmitRequestSchema.parse(value));
    json(res, 200, { ok: true, data: result });
  } catch (error) {
    if (error instanceof MaWorkbenchError) {
      const status = error.code === "FORBIDDEN" ? 403 : error.code === "NOT_FOUND" ? 404 : error.code === "INVALID_ASSESSMENT" ? 400 : 409;
      json(res, status, { ok: false, code: error.code, error: error.message });
    } else if (error instanceof ZodError || error instanceof SyntaxError) {
      json(res, 400, { ok: false, code: "INVALID_INPUT", error: error instanceof ZodError ? error.issues.map(item => item.message).join("；") : "请求内容格式错误" });
    } else if (error instanceof QualitySourceAiAssessmentError) {
      json(res, 503, { ok: false, code: "MODEL_NOT_CONFIGURED", error: "AI研判服务尚未配置，可先进行人工研判" });
    } else if (error instanceof AiOriginalAssessmentV0RunError) {
      json(res, 502, { ok: false, code: "AI_FAILED", error: "AI研判失败，请重试或先进行人工研判" });
    } else {
      const message = error instanceof Error ? error.message : "";
      if (message === "version conflict" || /来源资料已更新|version/.test(message)) json(res, 409, { ok: false, code: "VERSION_CONFLICT", error: "记录已更新，请刷新后重新核对" });
      else if (message === "OA 附件不存在") json(res, 404, { ok: false, code: "NOT_FOUND", error: "OA 附件不存在或已不可用" });
      else if (message.includes("钉钉 OA 尚未接入")) json(res, 503, { ok: false, code: "OA_NOT_CONNECTED", error: message });
      else if (/研判|分类|原因|request too large/.test(message)) json(res, 400, { ok: false, code: "INVALID_INPUT", error: message === "request too large" ? "请求内容过大" : message });
      else json(res, 500, { ok: false, code: "INTERNAL_ERROR", error: "操作未完成，请稍后重试" });
    }
  } finally { service.close(); }
}
