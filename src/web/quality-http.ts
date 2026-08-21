import type { IncomingMessage, ServerResponse } from "node:http";
import { z, ZodError } from "zod";
import { AiOriginalAssessmentV0RunError } from
  "../quality/ai-original-assessment/ai-original-assessment-v0-runner";
import { refreshQualityCandidates } from "../quality/candidates/quality-candidate-detector";
import { createQualityAssignmentService } from "../quality/assignments/quality-assignment-service";
import { createQualityClosureService } from "../quality/closure/quality-closure-service";
import { createQualityPrivateCommentService } from "../quality/comments/quality-private-comment-service";
import {
  qualityDraftFieldsSchema,
  qualityDraftPatchSchema,
} from "../quality/events/quality-event-schema";
import {
  createQualityEventService,
  type QualityEventActor,
} from "../quality/events/quality-event-service";
import { createQualityReportFileStore } from "../quality/files/quality-report-file-store";
import { QUALITY_MAX_FILE_BYTES } from "../quality/files/quality-report-file-store";
import { createQualityEvidenceService } from "../quality/evidence/quality-evidence-service";
import { createQualityReviewService } from "../quality/reviews/quality-review-service";
import { createQualitySourceReviewService } from "../quality/reviews/quality-source-review-service";
import { getQualityEvidencePackage } from "../quality/reviews/quality-event-projector";
import {
  QualitySourceAiAssessmentError,
  runQualitySourceAiAssessment,
} from "../quality/reviews/quality-source-ai-assessment-service";
import {
  createQualitySourceAssessmentService,
  saveQualitySourceAssessmentSchema,
} from "../quality/reviews/quality-source-assessment-service";
import { createQualityReadStore } from "../quality/infra/quality-read-store";
import { createQualityEventQuery } from "../quality/queries/quality-event-query";
import { createQualityReviewQuery } from "../quality/queries/quality-review-query";
import { createQualityNotificationOutbox } from "../quality/notifications/quality-notification-outbox";
import { createQualityStore } from "../quality/infra/quality-store";
import { createDingTalkQualitySource } from "../quality/source/dingtalk-quality-source";
import { createQualitySourceSync } from "../quality/source/quality-source-sync";
import { createQualitySourceWritebackOutbox } from "../quality/source/quality-source-writeback";
import { triggerQualitySourceWriteback } from "../quality/source/quality-source-writeback-runtime";
import { resolveQualityCapabilities } from "../security/quality-capabilities";
import { listWorkbenchManagerIds } from "../security/workbench-manager-whitelist";
import { readMultipartSingleFile } from "./multipart-single-file";
import { renderQualityTrackingPage } from "./quality-tracking-page";
import { renderQualityReviewPage } from "./quality-review-page";
import { renderQualityOpinionsPage } from "./quality-opinions-page";
import type { WorkbenchShellRole } from "./workbench-shell";

export interface QualityHttpSession {
  userId: string;
  role: "admin" | "manager" | "employee";
  dingUser?: { name?: string };
  loginSource?: string;
}

const QUALITY_PAGE_PATHS = new Set([
  "/workbench/quality",
  "/workbench/quality/review",
  "/workbench/quality/opinions",
]);

const QUALITY_STATIC_API_PATHS = new Set([
  "/api/workbench/quality/source",
  "/api/workbench/quality/source/sync",
  "/api/workbench/quality/candidates",
  "/api/workbench/quality/review-queue",
  "/api/workbench/quality/events",
  "/api/workbench/quality/events/drafts",
  "/api/workbench/quality/assessments/ai",
  "/api/workbench/quality/opinions/events",
  "/api/workbench/quality/opinions/threads",
]);

let manualSyncPromise: Promise<unknown> | null = null;

export function isQualityPagePath(pathname: string): boolean {
  return QUALITY_PAGE_PATHS.has(pathname);
}

export function isQualityApiPath(pathname: string): boolean {
  return QUALITY_STATIC_API_PATHS.has(pathname)
    || pathname === "/api/workbench/manager/quality-nodes"
    || /^\/api\/workbench\/manager\/quality-nodes\/[^/]+\/(?:accept|reject|delegate)$/.test(pathname)
    || /^\/api\/workbench\/manager\/quality-nodes\/[^/]+\/children\/[^/]+\/due$/.test(pathname)
    || /^\/api\/workbench\/quality\/nodes\/[^/]+\/(?:evidence|submit-completion)$/.test(pathname)
    || /^\/api\/workbench\/quality\/nodes\/[^/]+\/review$/.test(pathname)
    || /^\/api\/workbench\/quality\/evidence\/[^/]+$/.test(pathname)
    || /^\/api\/workbench\/quality\/events\/[^/]+\/(?:primary-review|evidence-package|assign-primary|due|return-node|close|reopen)$/.test(pathname)
    || /^\/api\/workbench\/quality\/candidates\/[^/]+\/dismiss$/.test(pathname)
    || /^\/api\/workbench\/quality\/source\/[^/]+\/(?:review|writeback\/retry)$/.test(pathname)
    || /^\/api\/workbench\/quality\/events\/[^/]+(?:\/draft|\/submit|\/supplements|\/corrections|\/files)?$/.test(pathname)
    || /^\/api\/workbench\/quality\/opinions\/threads\/[^/]+\/messages$/.test(pathname)
    || /^\/api\/workbench\/quality\/notifications\/[^/]+\/retry$/.test(pathname)
    || /^\/api\/workbench\/quality\/files\/[^/]+$/.test(pathname)
    || /^\/api\/workbench\/quality\/assessments\/[^/]+$/.test(pathname);
}

function writeJson(res: ServerResponse, statusCode: number, body: unknown): void {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store, must-revalidate",
  });
  res.end(JSON.stringify(body));
}

function forbidden(res: ServerResponse): void {
  writeJson(res, 403, { ok: false, error: "无质量业务访问权限" });
}

function hasRole(session: QualityHttpSession, role: "aftersales_manager" | "quality_specialist"): boolean {
  return resolveQualityCapabilities(session.userId).roles.includes(role);
}

function actorFor(session: QualityHttpSession, required?: "aftersales_manager" | "quality_specialist"): QualityEventActor {
  const caps = resolveQualityCapabilities(session.userId);
  const role = required ?? (caps.roles.includes("aftersales_manager")
    ? "aftersales_manager"
    : caps.roles.includes("quality_specialist")
      ? "quality_specialist"
      : null);
  if (!role || !caps.roles.includes(role)) throw new Error("quality action forbidden");
  return { userId: session.userId, role };
}

async function readJsonBody(req: IncomingMessage, maxBytes = 256 * 1024): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    total += buffer.length;
    if (total > maxBytes) throw new Error("request body too large");
    chunks.push(buffer);
  }
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return {};
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("request body must be an object");
  }
  return parsed as Record<string, unknown>;
}

function parsePositiveInt(value: unknown, fallback: number, max = Number.MAX_SAFE_INTEGER): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, max) : fallback;
}

function sourceKeys(value: unknown): string[] {
  return z.array(z.string().trim().min(1).max(300)).min(1).max(200).parse(value);
}

function requestId(value: unknown): string {
  return z.string().uuid().parse(value);
}

function errorResponse(error: unknown): { status: number; body: Record<string, unknown> } {
  const message = error instanceof Error ? error.message : String(error);
  if (error instanceof QualitySourceAiAssessmentError) {
    return {
      status: 503,
      body: { ok: false, error: "AI研判服务尚未配置，请人工处理" },
    };
  }
  if (error instanceof AiOriginalAssessmentV0RunError) {
    return {
      status: 502,
      body: { ok: false, error: "AI研判失败，请人工处理" },
    };
  }
  const sourceDuplicate = message.match(/^source already reported:(.+)$/);
  if (sourceDuplicate) {
    return {
      status: 409,
      body: {
        ok: false,
        error: "该来源已经通报",
        data: { existingEventId: sourceDuplicate[1] },
      },
    };
  }
  if (message.includes("version conflict")) {
    return { status: 409, body: { ok: false, error: "版本冲突，请刷新后重试" } };
  }
  if (/not found/.test(message)) {
    return { status: 404, body: { ok: false, error: "记录不存在或无权访问" } };
  }
  if (message.includes("forbidden")) {
    return { status: 403, body: { ok: false, error: "无质量业务操作权限" } };
  }
  if (/仅人工处理状态/.test(message)) {
    return { status: 409, body: { ok: false, error: message } };
  }
  if (/只有|只能|仅|无权|不属于/.test(message)) {
    return { status: 403, body: { ok: false, error: message } };
  }
  if (/超过 20 MB|file too large|exceeded/.test(message)) {
    return { status: 413, body: { ok: false, error: "证据文件不能超过 20 MB" } };
  }
  if (/文件类型不允许|file type not allowed/.test(message)) {
    return { status: 415, body: { ok: false, error: "不支持该证据文件类型" } };
  }
  if (/当前不可|不能晚于|不可替换/.test(message)) {
    return { status: 409, body: { ok: false, error: message } };
  }
  if (/不在待|当前节点/.test(message)) {
    return { status: 409, body: { ok: false, error: message } };
  }
  if (/必填|必须选择/.test(message)) {
    return { status: 400, body: { ok: false, error: message } };
  }
  if (error instanceof ZodError || error instanceof SyntaxError || /required|invalid|must|empty|too large|reason/.test(message)) {
    return { status: 400, body: { ok: false, error: "请求内容不符合要求" } };
  }
  console.error(JSON.stringify({
    event: "quality_http_failed",
    error: message.slice(0, 500),
  }));
  return { status: 500, body: { ok: false, error: "质量业务暂时无法处理，请稍后重试" } };
}

function detailForActor(eventId: string, session: QualityHttpSession) {
  const store = createQualityEventQuery();
  try {
    return store.getEventDetail({ eventId, viewerUserId: session.userId });
  } finally {
    store.close();
  }
}

async function runManualSync(): Promise<unknown> {
  if (manualSyncPromise) return manualSyncPromise;
  manualSyncPromise = (async () => {
    createQualityStore().close();
    const sync = createQualitySourceSync({
      reader: createDingTalkQualitySource(),
      refreshCandidates: async () => { refreshQualityCandidates(); },
    });
    try {
      return await sync.syncNow();
    } finally {
      sync.close();
    }
  })();
  try {
    return await manualSyncPromise;
  } finally {
    manualSyncPromise = null;
  }
}

async function handleQualityApi(input: {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  session: QualityHttpSession;
}): Promise<void> {
  const { req, res, url, session } = input;
  try {
    createQualityStore().close();
    const caps = resolveQualityCapabilities(session.userId);
    const aftersales = caps.roles.includes("aftersales_manager");
    const specialist = caps.roles.includes("quality_specialist");

    if (url.pathname === "/api/workbench/quality/review-queue") {
      if (!aftersales) { forbidden(res); return; }
      if (req.method !== "GET") { writeJson(res, 405, { ok: false, error: "请求方法不支持" }); return; }
      const query = createQualityReviewQuery();
      try {
        const data = query.list({
          scope: z.enum(["UNREVIEWED", "NEEDS_INFO", "COMPLETED"]).parse(url.searchParams.get("scope") ?? "UNREVIEWED"),
          q: url.searchParams.get("q") ?? "",
          risk: z.enum(["ALL", "HIGH_RISK", "REPEAT", "NONE"]).parse(url.searchParams.get("risk") ?? "ALL"),
          deviceModel: url.searchParams.get("deviceModel") ?? "",
          category: url.searchParams.get("category") ?? "",
          page: parsePositiveInt(url.searchParams.get("page"), 1),
          pageSize: parsePositiveInt(url.searchParams.get("pageSize"), 50, 200),
        });
        writeJson(res, 200, { ok: true, data });
      } finally { query.close(); }
      return;
    }

    const sourceReview = url.pathname.match(/^\/api\/workbench\/quality\/source\/([^/]+)\/review$/);
    if (sourceReview) {
      if (!aftersales) { forbidden(res); return; }
      if (req.method !== "POST") { writeJson(res, 405, { ok: false, error: "请求方法不支持" }); return; }
      const body = await readJsonBody(req);
      const service = createQualitySourceReviewService();
      try {
        const review = service.reviewSource({
          actorUserId: session.userId,
          sourceKey: decodeURIComponent(sourceReview[1]!),
          decision: z.enum(["ORDINARY", "NEEDS_INFO"]).parse(body.decision),
          note: body.note == null ? undefined : z.string().max(2000).parse(body.note),
          expectedVersion: z.number().int().min(0).parse(body.expectedVersion),
          requestId: requestId(body.requestId),
        });
        triggerQualitySourceWriteback();
        writeJson(res, 200, { ok: true, data: { review } });
      } finally { service.close(); }
      return;
    }

    const sourceWritebackRetry = url.pathname.match(/^\/api\/workbench\/quality\/source\/([^/]+)\/writeback\/retry$/);
    if (sourceWritebackRetry) {
      if (!aftersales) { forbidden(res); return; }
      if (req.method !== "POST") { writeJson(res, 405, { ok: false, error: "请求方法不支持" }); return; }
      const body = await readJsonBody(req);
      requestId(body.requestId);
      const sourceKey = decodeURIComponent(sourceWritebackRetry[1]!);
      const outbox = createQualitySourceWritebackOutbox();
      try {
        const failed = [...outbox.list(sourceKey)].reverse().find((item) => item.status === "DEAD");
        if (!failed) throw new Error("没有可重新入队的回写失败任务");
        const writeback = outbox.retryDead(failed.writebackId);
        triggerQualitySourceWriteback();
        writeJson(res, 200, { ok: true, data: { writeback } });
      } finally { outbox.close(); }
      return;
    }

    if (url.pathname.startsWith("/api/workbench/quality/opinions/")) {
      if (!caps.canAccessOpinions && !specialist) { forbidden(res); return; }
      const service = createQualityPrivateCommentService();
      try {
        if (req.method === "GET" && url.pathname === "/api/workbench/quality/opinions/events") {
          if (!caps.canAccessOpinions) { forbidden(res); return; }
          const events = caps.specialistUserIds.flatMap((specialistUserId) => service.listAvailableEvents({ reportUserId: session.userId, specialistUserId })
            .map((event) => ({ ...event, specialistUserId })));
          writeJson(res, 200, { ok: true, data: { events } }); return;
        }
        if (req.method === "GET" && url.pathname === "/api/workbench/quality/opinions/threads") {
          writeJson(res, 200, { ok: true, data: { threads: service.listThreads(session.userId) } }); return;
        }
        if (req.method === "POST" && url.pathname === "/api/workbench/quality/opinions/threads") {
          if (!caps.canAccessOpinions) { forbidden(res); return; }
          const body = await readJsonBody(req);
          const thread = service.createThread({
            eventId: z.string().trim().min(1).max(300).parse(body.eventId),
            specialistUserId: z.string().trim().min(1).max(200).parse(body.specialistUserId),
            reportUserId: session.userId,
          });
          writeJson(res, 201, { ok: true, data: thread }); return;
        }
        const messages = url.pathname.match(/^\/api\/workbench\/quality\/opinions\/threads\/([^/]+)\/messages$/);
        if (messages && req.method === "GET") {
          const threadId = decodeURIComponent(messages[1]!);
          const thread = service.listThreads(session.userId).find((item) => item.threadId === threadId);
          if (!thread) throw new Error("无权访问私密质量评论");
          writeJson(res, 200, { ok: true, data: { thread, messages: service.listMessages({ threadId, viewerUserId: session.userId }) } }); return;
        }
        if (messages && req.method === "POST") {
          const body = await readJsonBody(req);
          const message = service.sendMessage({
            threadId: decodeURIComponent(messages[1]!), senderUserId: session.userId,
            body: z.string().trim().min(1).max(5000).parse(body.body), requestId: requestId(body.requestId),
          });
          writeJson(res, 201, { ok: true, data: { message } }); return;
        }
      } finally { service.close(); }
      writeJson(res, 404, { ok: false, error: "质量意见接口不存在" }); return;
    }

    const notificationRetry = url.pathname.match(/^\/api\/workbench\/quality\/notifications\/([^/]+)\/retry$/);
    if (req.method === "POST" && notificationRetry) {
      if (!specialist) throw new Error("仅质量专员可重新入队质量通知");
      const body = await readJsonBody(req);
      const outbox = createQualityNotificationOutbox();
      try {
        const notification = outbox.retryDead(decodeURIComponent(notificationRetry[1]!), { actorUserId: session.userId, requestId: requestId(body.requestId) });
        writeJson(res, 200, { ok: true, data: { notification } });
      } finally { outbox.close(); }
      return;
    }

    const evidenceUpload = url.pathname.match(/^\/api\/workbench\/quality\/nodes\/([^/]+)\/evidence$/);
    const evidenceCompletion = url.pathname.match(/^\/api\/workbench\/quality\/nodes\/([^/]+)\/submit-completion$/);
    const evidenceDownload = url.pathname.match(/^\/api\/workbench\/quality\/evidence\/([^/]+)$/);
    const childReview = url.pathname.match(/^\/api\/workbench\/quality\/nodes\/([^/]+)\/review$/);
    const primaryReview = url.pathname.match(/^\/api\/workbench\/quality\/events\/([^/]+)\/primary-review$/);
    const evidencePackage = url.pathname.match(/^\/api\/workbench\/quality\/events\/([^/]+)\/evidence-package$/);
    if (req.method === "POST" && childReview) {
      const body = await readJsonBody(req);
      const service = createQualityReviewService();
      try {
        const node = service.reviewDirectChild({
          childNodeId: decodeURIComponent(childReview[1]!),
          actorUserId: session.userId,
          decision: z.enum(["APPROVE", "RETURN"]).parse(body.decision),
          reason: body.reason == null ? undefined : z.string().max(2000).parse(body.reason),
          expectedVersion: parsePositiveInt(body.expectedVersion, 0),
          requestId: requestId(body.requestId),
        });
        writeJson(res, 200, { ok: true, data: { node } });
      } finally { service.close(); }
      return;
    }
    if (req.method === "POST" && primaryReview) {
      const body = await readJsonBody(req);
      const service = createQualityReviewService();
      try {
        const event = service.primaryReview({
          eventId: decodeURIComponent(primaryReview[1]!),
          primaryManagerUserId: session.userId,
          decision: z.enum(["APPROVE", "RETURN_NODE"]).parse(body.decision),
          returnedNodeId: body.returnedNodeId == null ? undefined : z.string().min(1).max(300).parse(body.returnedNodeId),
          reason: body.reason == null ? undefined : z.string().max(2000).parse(body.reason),
          expectedVersion: parsePositiveInt(body.expectedVersion, 0),
          requestId: requestId(body.requestId),
        });
        writeJson(res, 200, { ok: true, data: { event } });
      } finally { service.close(); }
      return;
    }
    if (req.method === "GET" && evidencePackage) {
      const data = getQualityEvidencePackage({
        eventId: decodeURIComponent(evidencePackage[1]!),
        viewerUserId: session.userId,
        isQualitySpecialist: specialist,
        isAftersalesManager: aftersales,
      });
      writeJson(res, 200, { ok: true, data });
      return;
    }
    if (req.method === "POST" && evidenceUpload) {
      const parsed = await readMultipartSingleFile(req, { maxFileBytes: QUALITY_MAX_FILE_BYTES });
      if (!parsed.file) throw new Error("证据文件必填");
      const service = createQualityEvidenceService();
      try {
        const evidence = service.uploadEvidence({
          nodeId: decodeURIComponent(evidenceUpload[1]!),
          actorUserId: session.userId,
          originalName: parsed.file.filename,
          mimeType: parsed.file.mimeType,
          summary: z.string().trim().min(1).max(2000).parse(parsed.fields.summary),
          buffer: parsed.file.buffer,
          requestId: requestId(parsed.fields.requestId),
        });
        writeJson(res, 201, { ok: true, data: { evidence } });
      } finally {
        service.close();
      }
      return;
    }
    if (req.method === "POST" && evidenceCompletion) {
      const body = await readJsonBody(req);
      const service = createQualityEvidenceService();
      try {
        const result = service.submitCompletion({
          nodeId: decodeURIComponent(evidenceCompletion[1]!),
          actorUserId: session.userId,
          expectedVersion: parsePositiveInt(body.expectedVersion, 0),
          requestId: requestId(body.requestId),
        });
        writeJson(res, 200, { ok: true, data: result });
      } finally {
        service.close();
      }
      return;
    }
    if (req.method === "GET" && evidenceDownload) {
      const service = createQualityEvidenceService();
      try {
        const result = service.readEvidence({
          evidenceId: decodeURIComponent(evidenceDownload[1]!),
          actorUserId: session.userId,
          actorRole: specialist ? "quality_specialist" : aftersales ? "aftersales_manager" : undefined,
        });
        res.writeHead(200, {
          "Content-Type": result.metadata.mimeType,
          "Content-Length": String(result.buffer.byteLength),
          "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(result.metadata.originalName)}`,
          "Cache-Control": "private, no-store",
          "X-Content-Type-Options": "nosniff",
        });
        res.end(result.buffer);
      } finally {
        service.close();
      }
      return;
    }

    if (url.pathname.startsWith("/api/workbench/manager/quality-nodes")) {
      if (!listWorkbenchManagerIds().has(session.userId)) {
        forbidden(res);
        return;
      }
      if (req.method === "GET" && url.pathname === "/api/workbench/manager/quality-nodes") {
        const store = createQualityReadStore();
        try {
          writeJson(res, 200, { ok: true, data: { nodes: store.listManagerAssignmentNodes(session.userId) } });
        } finally {
          store.close();
        }
        return;
      }
      const nodeAction = url.pathname.match(/^\/api\/workbench\/manager\/quality-nodes\/([^/]+)\/(accept|reject|delegate)$/);
      const dueAction = url.pathname.match(/^\/api\/workbench\/manager\/quality-nodes\/([^/]+)\/children\/([^/]+)\/due$/);
      const body = await readJsonBody(req);
      const service = createQualityAssignmentService();
      try {
        if (req.method === "POST" && nodeAction?.[2] === "accept") {
          const result = await service.acceptNode({
            nodeId: decodeURIComponent(nodeAction[1]!),
            actorUserId: session.userId,
            expectedVersion: parsePositiveInt(body.expectedVersion, 0),
            requestId: requestId(body.requestId),
          });
          writeJson(res, 200, { ok: true, data: result });
          return;
        }
        if (req.method === "POST" && nodeAction?.[2] === "reject") {
          const result = await service.rejectNode({
            nodeId: decodeURIComponent(nodeAction[1]!),
            actorUserId: session.userId,
            expectedVersion: parsePositiveInt(body.expectedVersion, 0),
            requestId: requestId(body.requestId),
            reason: z.string().trim().min(1).max(1000).parse(body.reason),
          });
          writeJson(res, 200, { ok: true, data: result });
          return;
        }
        if (req.method === "POST" && nodeAction?.[2] === "delegate") {
          const result = await service.delegateNode({
            parentNodeId: decodeURIComponent(nodeAction[1]!),
            actorUserId: session.userId,
            assigneeUserId: z.string().trim().min(1).max(200).parse(body.assigneeUserId),
            assigneeKind: z.enum(["MANAGER", "EMPLOYEE"]).parse(body.assigneeKind),
            departmentName: z.string().trim().min(1).max(200).parse(body.departmentName),
            dueAt: z.string().trim().min(1).max(64).parse(body.dueAt),
            requirement: z.string().trim().min(1).max(5000).parse(body.requirement),
            expectedVersion: parsePositiveInt(body.expectedVersion, 0),
            requestId: requestId(body.requestId),
          });
          writeJson(res, 201, { ok: true, data: result });
          return;
        }
        if (req.method === "POST" && dueAction) {
          const result = await service.changeDirectChildDueAt({
            childNodeId: decodeURIComponent(dueAction[2]!),
            actorUserId: session.userId,
            dueAt: z.string().trim().min(1).max(64).parse(body.dueAt),
            reason: z.string().trim().min(1).max(1000).parse(body.reason),
            expectedVersion: parsePositiveInt(body.expectedVersion, 0),
            requestId: requestId(body.requestId),
          });
          writeJson(res, 200, { ok: true, data: result });
          return;
        }
      } finally {
        service.close();
      }
      writeJson(res, 404, { ok: false, error: "质量任务操作不存在" });
      return;
    }

    if (url.pathname.startsWith("/api/workbench/quality/source")
      || url.pathname.startsWith("/api/workbench/quality/candidates")
      || url.pathname.startsWith("/api/workbench/quality/assessments")) {
      if (!aftersales) {
        forbidden(res);
        return;
      }
    } else if (!caps.canAccessTracking) {
      forbidden(res);
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/workbench/quality/source") {
      const store = createQualityReadStore();
      try {
        const reportedParam = url.searchParams.get("reported");
        writeJson(res, 200, {
          ok: true,
          data: store.listSourceRows({
            q: url.searchParams.get("q") ?? "",
            page: parsePositiveInt(url.searchParams.get("page"), 1),
            pageSize: parsePositiveInt(url.searchParams.get("pageSize"), 50, 200),
            reported: reportedParam === "1" ? true : reportedParam === "0" ? false : undefined,
            reviewStatus: z.enum(["PENDING", "REVIEWED", "REPORTED"])
              .optional().parse(url.searchParams.get("reviewStatus") ?? undefined),
            riskLevel: z.enum(["LOW", "MEDIUM", "HIGH"])
              .optional().parse(url.searchParams.get("riskLevel") ?? undefined),
          }),
        });
      } finally {
        store.close();
      }
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/workbench/quality/source/sync") {
      const result = await runManualSync();
      writeJson(res, 200, { ok: true, data: { result } });
      return;
    }

    if (req.method === "POST"
      && url.pathname === "/api/workbench/quality/assessments/ai") {
      const body = z.object({
        sourceKey: z.string().trim().min(1).max(300),
      }).strict().parse(await readJsonBody(req));
      const result = await runQualitySourceAiAssessment({
        sourceKey: body.sourceKey,
      });
      writeJson(res, 200, { ok: true, data: result });
      return;
    }

    const sourceAssessmentMatch = url.pathname.match(
      /^\/api\/workbench\/quality\/assessments\/([^/]+)$/,
    );
    if (sourceAssessmentMatch && req.method === "GET") {
      const sourceKey = decodeURIComponent(sourceAssessmentMatch[1]!);
      const service = createQualitySourceAssessmentService();
      try {
        const workspace = service.getReviewWorkspace(sourceKey);
        writeJson(res, 200, {
          ok: true,
          data: {
            source: {
              ...workspace.source.normalizedFeedback,
              sourceVersion: workspace.source.sourceVersion,
              sourceState: workspace.source.state,
              sheetName: workspace.source.sheetName,
            },
            assessment: workspace.assessment,
          },
        });
      } finally {
        service.close();
      }
      return;
    }
    if (sourceAssessmentMatch && req.method === "PUT") {
      const sourceKey = decodeURIComponent(sourceAssessmentMatch[1]!);
      const assessment = saveQualitySourceAssessmentSchema.parse(
        await readJsonBody(req),
      );
      const service = createQualitySourceAssessmentService();
      try {
        const saved = service.saveAssessment({
          sourceKey,
          actorUserId: session.userId,
          assessment,
        });
        writeJson(res, 200, { ok: true, data: { assessment: saved } });
      } finally {
        service.close();
      }
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/workbench/quality/candidates") {
      const store = createQualityReadStore();
      try {
        writeJson(res, 200, {
          ok: true,
          data: store.listCandidates({
            page: parsePositiveInt(url.searchParams.get("page"), 1),
            pageSize: parsePositiveInt(url.searchParams.get("pageSize"), 50, 200),
            status: url.searchParams.get("status") ?? "OPEN",
          }),
        });
      } finally {
        store.close();
      }
      return;
    }

    const dismissMatch = url.pathname.match(/^\/api\/workbench\/quality\/candidates\/([^/]+)\/dismiss$/);
    if (req.method === "POST" && dismissMatch) {
      const body = await readJsonBody(req);
      const service = createQualityEventService();
      try {
        service.dismissCandidate({
          actor: actorFor(session, "aftersales_manager"),
          candidateId: decodeURIComponent(dismissMatch[1]!),
          expectedVersion: parsePositiveInt(body.expectedVersion, 0),
          reason: z.string().trim().min(1).max(1000).parse(body.reason),
        });
      } finally {
        service.close();
      }
      writeJson(res, 200, { ok: true });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/workbench/quality/events") {
      const store = createQualityEventQuery();
      try {
        const query = (url.searchParams.get("q") ?? "").trim().toLocaleLowerCase("zh-CN");
        const status = url.searchParams.get("status")?.trim().toUpperCase();
        const riskLevel = url.searchParams.get("riskLevel")?.trim().toUpperCase();
        const events = store.listEvents({ viewerUserId: session.userId }).filter((event) => {
          if (status && event.status !== status) return false;
          if (riskLevel && (riskLevel === "HIGH"
            ? !["HIGH", "CRITICAL"].includes(event.urgency ?? "")
            : event.urgency !== riskLevel)) return false;
          if (!query) return true;
          return [
            event.eventNo,
            event.title,
            event.problemStatus,
            event.deviceModel,
            event.deviceSerial,
            event.catheterBatch,
            event.initialCategory,
          ].some((value) => String(value ?? "").toLocaleLowerCase("zh-CN").includes(query));
        });
        const page = parsePositiveInt(url.searchParams.get("page"), 1);
        const pageSize = parsePositiveInt(url.searchParams.get("pageSize"), 50, 200);
        const start = (page - 1) * pageSize;
        writeJson(res, 200, {
          ok: true,
          data: {
            events: events.slice(start, start + pageSize),
            pagination: { page, pageSize, total: events.length, pageCount: Math.ceil(events.length / pageSize) },
          },
        });
      } finally {
        store.close();
      }
      return;
    }

    const specialistAction = url.pathname.match(/^\/api\/workbench\/quality\/events\/([^/]+)\/(assign-primary|due|return-node|close|reopen)$/);
    if (req.method === "POST" && specialistAction) {
      if (!specialist) throw new Error("仅质量专员可执行该操作");
      const eventId = decodeURIComponent(specialistAction[1]!);
      const action = specialistAction[2]!;
      const body = await readJsonBody(req);
      if (action === "assign-primary" || action === "due") {
        const service = createQualityAssignmentService();
        try {
          if (action === "assign-primary") {
            const result = await service.assignPrimary({
              eventId,
              specialistUserId: session.userId,
              primaryManagerUserId: z.string().trim().min(1).max(200).parse(body.primaryManagerUserId),
              dueAt: z.string().trim().min(1).max(64).parse(body.dueAt),
              taskRequirement: z.string().trim().min(1).max(5000).parse(body.taskRequirement),
              expectedVersion: parsePositiveInt(body.expectedVersion, 0),
              requestId: requestId(body.requestId),
            });
            writeJson(res, 201, { ok: true, data: result });
          } else {
            const event = await service.changeEventDueAt({
              eventId,
              specialistUserId: session.userId,
              dueAt: z.string().trim().min(1).max(64).parse(body.dueAt),
              reason: z.string().trim().min(1).max(1000).parse(body.reason),
              expectedVersion: parsePositiveInt(body.expectedVersion, 0),
              requestId: requestId(body.requestId),
            });
            writeJson(res, 200, { ok: true, data: { event } });
          }
        } finally { service.close(); }
        return;
      }
      const service = createQualityClosureService();
      try {
        if (action === "return-node") {
          const result = service.returnSpecificNode({
            eventId, nodeId: z.string().trim().min(1).max(300).parse(body.nodeId), specialistUserId: session.userId,
            reason: z.string().trim().min(1).max(2000).parse(body.reason), expectedVersion: parsePositiveInt(body.expectedVersion, 0), requestId: requestId(body.requestId),
          });
          writeJson(res, 200, { ok: true, data: result });
        } else if (action === "close") {
          const event = service.closeEvent({
            eventId, specialistUserId: session.userId, conclusion: z.string().trim().min(1).max(10000).parse(body.conclusion),
            expectedVersion: parsePositiveInt(body.expectedVersion, 0), requestId: requestId(body.requestId),
          });
          writeJson(res, 200, { ok: true, data: { event } });
        } else {
          const result = service.reopenEvent({
            eventId, nodeId: z.string().trim().min(1).max(300).parse(body.nodeId), specialistUserId: session.userId,
            reason: z.string().trim().min(1).max(2000).parse(body.reason), expectedVersion: parsePositiveInt(body.expectedVersion, 0), requestId: requestId(body.requestId),
          });
          writeJson(res, 200, { ok: true, data: result });
        }
      } finally { service.close(); }
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/workbench/quality/events/drafts") {
      if (!aftersales) throw new Error("quality action forbidden");
      const body = await readJsonBody(req);
      const service = createQualityEventService();
      let result;
      try {
        const keys = Array.isArray(body.sourceKeys) && body.sourceKeys.length > 0
          ? sourceKeys(body.sourceKeys)
          : [];
        result = keys.length > 0
          ? service.createDraftFromSources({
            actor: actorFor(session, "aftersales_manager"),
            requestId: requestId(body.requestId),
            sourceKeys: keys,
            overrides: body.draft == null
              ? undefined
              : qualityDraftFieldsSchema.partial().parse(body.draft),
          })
          : service.createManualDraft({
            actor: actorFor(session, "aftersales_manager"),
            requestId: requestId(body.requestId),
            draft: qualityDraftFieldsSchema.parse(body.draft),
            similarEventIds: body.similarEventIds == null
              ? undefined
              : z.array(z.string().trim().min(1)).max(50).parse(body.similarEventIds),
            independentReason: body.independentReason == null
              ? undefined
              : z.string().trim().max(1000).parse(body.independentReason),
          });
        const sourceSnapshots = service.listSourceLinks(result.event.eventId);
        if (!result.created) {
          writeJson(res, 409, {
            ok: false,
            error: "该来源已经通报",
            data: { existingEventId: result.event.eventId, event: result.event, sourceSnapshots },
          });
          return;
        }
        writeJson(res, 201, { ok: true, data: { event: result.event, sourceSnapshots } });
      } finally {
        service.close();
      }
      return;
    }

    const eventMatch = url.pathname.match(/^\/api\/workbench\/quality\/events\/([^/]+)(?:\/(draft|submit|supplements|corrections|files))?$/);
    if (eventMatch) {
      const eventId = decodeURIComponent(eventMatch[1]!);
      const action = eventMatch[2] ?? "detail";

      if (req.method === "GET" && action === "detail") {
        const detail = detailForActor(eventId, session);
        if (!detail) {
          writeJson(res, 404, { ok: false, error: "记录不存在或无权访问" });
          return;
        }
        writeJson(res, 200, { ok: true, data: detail });
        return;
      }

      if (req.method === "POST" && action === "files") {
        if (!aftersales) throw new Error("quality action forbidden");
        const upload = await readMultipartSingleFile(req, { maxFileBytes: 20 * 1024 * 1024 });
        if (!upload.file) throw new Error("file is required");
        const store = createQualityReportFileStore();
        try {
          const metadata = store.save({
            eventId,
            actorUserId: session.userId,
            requestId: requestId(upload.fields.requestId),
            originalName: upload.file.filename,
            mimeType: upload.file.mimeType,
            buffer: upload.file.buffer,
          });
          const detail = detailForActor(eventId, session);
          writeJson(res, 201, { ok: true, data: { file: metadata, event: detail?.event } });
        } finally {
          store.close();
        }
        return;
      }

      const body = await readJsonBody(req);
      const service = createQualityEventService();
      try {
        const aftersalesActor = () => actorFor(session, "aftersales_manager");
        if (req.method === "PATCH" && action === "draft") {
          const event = service.updateDraft({
            actor: aftersalesActor(),
            eventId,
            expectedVersion: parsePositiveInt(body.expectedVersion, 0),
            requestId: requestId(body.requestId),
            patch: qualityDraftPatchSchema.parse(body.patch),
            reason: body.reason == null ? undefined : z.string().trim().max(1000).parse(body.reason),
          });
          writeJson(res, 200, { ok: true, data: { event } });
          return;
        }
        if (req.method === "DELETE" && action === "draft") {
          service.deleteDraft({
            actor: aftersalesActor(),
            eventId,
            expectedVersion: parsePositiveInt(body.expectedVersion, 0),
            requestId: requestId(body.requestId),
            reason: z.string().trim().min(1).max(1000).parse(body.reason),
          });
          writeJson(res, 200, { ok: true });
          return;
        }
        if (req.method === "POST" && action === "submit") {
          const event = service.submitDraft({
            actor: aftersalesActor(),
            eventId,
            expectedVersion: parsePositiveInt(body.expectedVersion, 0),
            requestId: requestId(body.requestId),
          });
          triggerQualitySourceWriteback();
          writeJson(res, 200, { ok: true, data: { event } });
          return;
        }
        if (req.method === "POST" && action === "supplements") {
          const result = service.addSupplement({
            actor: actorFor(session),
            eventId,
            expectedVersion: parsePositiveInt(body.expectedVersion, 0),
            requestId: requestId(body.requestId),
            content: z.string().trim().min(1).max(10000).parse(body.content),
          });
          writeJson(res, 201, { ok: true, data: result });
          return;
        }
        if (req.method === "POST" && action === "corrections") {
          const event = service.correctSubmittedReport({
            actor: aftersalesActor(),
            eventId,
            expectedVersion: parsePositiveInt(body.expectedVersion, 0),
            requestId: requestId(body.requestId),
            reason: z.string().trim().min(1).max(1000).parse(body.reason),
            patch: qualityDraftPatchSchema.parse(body.patch),
          });
          writeJson(res, 200, { ok: true, data: { event } });
          return;
        }
      } finally {
        service.close();
      }
    }

    const fileMatch = url.pathname.match(/^\/api\/workbench\/quality\/files\/([^/]+)$/);
    if (req.method === "GET" && fileMatch) {
      const fileId = decodeURIComponent(fileMatch[1]!);
      const role = specialist ? "quality_specialist" : "aftersales_manager";
      const store = createQualityReportFileStore();
      try {
        const metadata = store.getMetadata(fileId, session.userId, role);
        const buffer = store.readForAuthorizedUser(fileId, session.userId, role);
        res.writeHead(200, {
          "Content-Type": metadata.mimeType,
          "Content-Length": String(buffer.byteLength),
          "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(metadata.originalName)}`,
          "Cache-Control": "private, no-store",
          "X-Content-Type-Options": "nosniff",
        });
        res.end(buffer);
      } finally {
        store.close();
      }
      return;
    }

    writeJson(res, 404, { ok: false, error: "质量接口不存在" });
  } catch (error) {
    const response = errorResponse(error);
    if (response.status === 409) {
      const match = url.pathname.match(/^\/api\/workbench\/quality\/events\/([^/]+)/);
      if (match) {
        const store = createQualityStore();
        try {
          const latest = store.getEvent(decodeURIComponent(match[1]!));
          if (latest) response.body.data = { latestVersion: latest.version };
        } finally { store.close(); }
      }
    }
    writeJson(res, response.status, response.body);
  }
}

export function handleQualityHttp(input: {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  session: QualityHttpSession;
}): boolean {
  const { req, res, url, session } = input;
  if (!isQualityPagePath(url.pathname) && !isQualityApiPath(url.pathname)) return false;
  if (session.loginSource === "external_password") {
    forbidden(res);
    return true;
  }
  const caps = resolveQualityCapabilities(session.userId);
  const isHead = req.method === "HEAD";

  if ((req.method === "GET" || isHead)
    && (url.pathname === "/workbench/quality"
      || url.pathname === "/workbench/quality/review")) {
    if (!caps.canAccessTracking
      || (url.pathname === "/workbench/quality/review"
        && !caps.roles.includes("aftersales_manager"))) {
      forbidden(res);
      return true;
    }
    const html = renderQualityTrackingPage({
      role: session.role as WorkbenchShellRole,
      userId: session.userId,
      userLabel: session.dingUser?.name,
      canReport: caps.roles.includes("aftersales_manager"),
      isSpecialist: caps.roles.includes("quality_specialist"),
      reviewSourceKey: url.pathname === "/workbench/quality/review"
        ? url.searchParams.get("sourceKey") ?? ""
        : undefined,
    });
    res.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store, must-revalidate",
    });
    res.end(isHead ? "" : html);
    return true;
  }

  if ((req.method === "GET" || isHead) && url.pathname === "/workbench/quality/review") {
    if (!caps.roles.includes("aftersales_manager")) {
      forbidden(res);
      return true;
    }
    const html = renderQualityReviewPage({
      role: session.role as WorkbenchShellRole,
      userId: session.userId,
      userLabel: session.dingUser?.name,
    });
    res.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store, must-revalidate",
    });
    res.end(isHead ? "" : html);
    return true;
  }

  if ((req.method === "GET" || isHead) && url.pathname === "/workbench/quality/opinions") {
    if (!caps.canAccessOpinions && !caps.roles.includes("quality_specialist")) {
      forbidden(res);
      return true;
    }
    const html = renderQualityOpinionsPage({
      role: session.role as WorkbenchShellRole,
      userId: session.userId,
      isSpecialist: caps.roles.includes("quality_specialist"),
    });
    res.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store, must-revalidate",
    });
    res.end(isHead ? "" : html);
    return true;
  }

  void handleQualityApi(input);
  return true;
}
