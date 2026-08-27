import type { IncomingMessage, ServerResponse } from "node:http";
import { DatabaseSync } from "node:sqlite";
import { z, ZodError } from "zod";
import { AiOriginalAssessmentV0RunError } from
  "../quality/ai-original-assessment/ai-original-assessment-v0-runner";
import { refreshQualityCandidates } from "../quality/candidates/quality-candidate-detector";
import { createQualityAssignmentService } from "../quality/assignments/quality-assignment-service";
import { createQualitySupervisorDirectory } from "../quality/assignments/quality-supervisor-directory";
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
import {
  createQualityEventPerspectiveProjector,
  resolveQualityPerspectiveContext,
  type QualityPerspectiveRequest,
} from "../quality/presentation/quality-event-perspective";
import { createQualityReviewQuery } from "../quality/queries/quality-review-query";
import { createQualityNotificationOutbox } from "../quality/notifications/quality-notification-outbox";
import {
  confirmQualityAnalysisSchema,
  saveQualityAnalysisDraftSchema,
} from "../quality/analysis/quality-analysis-contracts";
import {
  createQualityAnalysisService,
  QualityAnalysisError,
} from "../quality/analysis/quality-analysis-service";
import { createQualityDepartmentDirectory } from
  "../quality/analysis/quality-department-directory";
import { createQualityStore } from "../quality/infra/quality-store";
import { createDingTalkQualitySource } from "../quality/source/dingtalk-quality-source";
import { createQualitySourceSync } from "../quality/source/quality-source-sync";
import { createQualitySourceWritebackOutbox } from "../quality/source/quality-source-writeback";
import { triggerQualitySourceWriteback } from "../quality/source/quality-source-writeback-runtime";
import { resolveQualityCapabilities } from "../security/quality-capabilities";
import { resolveWorkbenchSqlitePath } from "../infra/workbench-db-path";
import { hasQualityPlanningHandoff } from "../quality/queries/quality-event-query";
import { listWorkbenchManagerIds } from "../security/workbench-manager-whitelist";
import { readMultipartSingleFile } from "./multipart-single-file";
import { renderQualityTrackingPage } from "./quality-tracking-page";
import { renderQualityReviewPage } from "./quality-review-page";
import { renderQualityOpinionsPage } from "./quality-opinions-page";
import type { WorkbenchShellRole } from "./workbench-shell";
import type { WorkbenchSession } from "./assignment-workbench-session-types";
import { decorateWorkbenchHtmlForAdminImpersonation } from "./workbench-admin-impersonation";
import { getAdminTestActor } from "../testing/admin-test-actors";
import {
  isQualityRolePanelsEnabled,
  isQualityTestActorsEnabled,
} from "../quality/testing/quality-feature-flags";
import { resolveQualityTestActor } from "../quality/testing/quality-test-actors";
import { createQualityTestAnalysisService } from
  "../quality/testing/quality-test-analysis-service";
import { createQualityTestAftersalesService } from
  "../quality/testing/quality-test-aftersales-service";
import { createQualityTestAiService } from
  "../quality/testing/quality-test-ai-service";
import { qualityStatusLabel } from "../quality/presentation/quality-display-labels";

export interface QualityHttpSession {
  userId: string;
  role: "admin" | "manager" | "employee";
  dingUser?: WorkbenchSession["dingUser"];
  loginSource?: WorkbenchSession["loginSource"];
  impersonation?: WorkbenchSession["impersonation"];
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
    || /^\/api\/workbench\/quality\/events\/[^/]+\/(?:supervisor-options|assign-supervisor|test-employee-options|test-action)$/.test(pathname)
    || /^\/api\/workbench\/quality\/candidates\/[^/]+\/dismiss$/.test(pathname)
    || /^\/api\/workbench\/quality\/source\/[^/]+\/(?:review|writeback\/retry)$/.test(pathname)
    || /^\/api\/workbench\/quality\/events\/[^/]+(?:\/draft|\/submit|\/supplements|\/corrections|\/files)?$/.test(pathname)
    || /^\/api\/workbench\/quality\/events\/[^/]+\/analysis(?:\/(?:generate|draft|confirm))?$/.test(pathname)
    || /^\/api\/workbench\/quality\/opinions\/threads\/[^/]+\/messages$/.test(pathname)
    || /^\/api\/workbench\/quality\/notifications\/[^/]+\/retry$/.test(pathname)
    || /^\/api\/workbench\/quality\/files\/[^/]+$/.test(pathname)
    || /^\/api\/workbench\/quality\/assessments\/[^/]+(?:\/disposition)?$/.test(pathname);
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

type QualityManagerMetricStage = "ACCEPT" | "DELEGATE" | "EXECUTION" | "REVIEW" | "CLOSED";

function qualityManagerMetricStage(input: {
  db: DatabaseSync;
  eventId: string;
  eventStatus: string;
  managerUserId: string;
}): QualityManagerMetricStage | null {
  const own = input.db.prepare(`
    SELECT node_id,parent_node_id,status
    FROM quality_assignment_nodes
    WHERE event_id=? AND assignee_user_id=? AND status NOT IN ('REJECTED','CANCELLED')
    ORDER BY CASE WHEN parent_node_id IS NULL THEN 0 ELSE 1 END,depth,created_at,node_id
    LIMIT 1
  `).get(input.eventId, input.managerUserId) as Record<string, unknown> | undefined;
  if (!own) return null;
  if (input.eventStatus === "CLOSED") return "CLOSED";
  if (String(own.status) === "PENDING_ACCEPTANCE") return "ACCEPT";
  const childCounts = input.db.prepare(`
    SELECT COUNT(*) AS total,
      SUM(CASE WHEN status='PENDING_PARENT_REVIEW' THEN 1 ELSE 0 END) AS pending_review
    FROM quality_assignment_nodes
    WHERE parent_node_id=? AND status NOT IN ('REJECTED','CANCELLED')
  `).get(String(own.node_id)) as Record<string, unknown>;
  if (Number(childCounts.pending_review ?? 0) > 0
    || (input.eventStatus === "PENDING_PRIMARY_REVIEW" && own.parent_node_id == null)) {
    return "REVIEW";
  }
  if (Number(childCounts.total ?? 0) === 0
    && ["IN_PROGRESS", "RETURNED"].includes(String(own.status))) {
    return "DELEGATE";
  }
  return "EXECUTION";
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
  if (error instanceof QualityAnalysisError) {
    const status = error.code === "FORBIDDEN" ? 403
      : error.code === "MODEL_NOT_CONFIGURED" ? 503
        : 502;
    return { status, body: { ok: false, error: error.message, code: error.code } };
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
  if (/候选已失效|候选无效/.test(message)) {
    return { status: 409, body: { ok: false, error: "候选人已变化，请重新选择" } };
  }
  if (/来源资料已更新|最终研判已更新|已经通报|已进入质量流程|正式处置必须|才可创建通报/.test(message)) {
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

function listQualityManagerPerspectives() {
  const directory = createQualityDepartmentDirectory();
  try {
    return directory.listManagerPerspectives();
  } finally {
    directory.close();
  }
}

function readViewerUserId(input: {
  session: QualityHttpSession;
  adminReadOnly: boolean;
  url: URL;
}): string {
  if (!input.adminReadOnly) return input.session.userId;
  const requested = String(input.url.searchParams.get("managerUserId") ?? "").trim();
  if (!requested) return input.session.userId;
  const allowed = listQualityManagerPerspectives()
    .some((item) => item.managerUserId === requested);
  if (!allowed) throw new Error("管理员选择的主管视角不存在或主管映射当前不可用");
  return requested;
}

function projectedErrorResponse(response: { status: number; body: Record<string, unknown> }) {
  const fallback = response.status === 403 ? "当前视角无权执行此操作"
    : response.status === 404 ? "记录不存在或当前视角不可见"
      : response.status === 409 ? "数据已更新，请刷新后重试"
        : response.status === 400 ? "请求内容不符合要求"
          : "操作未完成，请稍后重试";
  const message = typeof response.body.error === "string" && response.body.error.trim()
    ? response.body.error
    : fallback;
  const errorCategory = response.status === 403 ? "permission"
    : response.status === 404 ? "not_found"
      : response.status === 409 ? "conflict"
        : response.status === 400 ? "validation"
          : "service";
  return {
    status: response.status,
    body: { ok: false, error: { message, errorCategory } },
  };
}

function perspectiveRequest(url: URL, session: QualityHttpSession): QualityPerspectiveRequest {
  return {
    viewerUserId: session.userId,
    perspective: url.searchParams.get("perspective") as QualityPerspectiveRequest["perspective"],
    testActorRef: isQualityTestActorsEnabled() ? url.searchParams.get("testActor") : null,
  };
}

function projectedDetail(eventId: string, url: URL, session: QualityHttpSession) {
  const projector = createQualityEventPerspectiveProjector();
  try {
    return projector.getEventDetail({
      ...perspectiveRequest(url, session),
      eventId,
    });
  } finally {
    projector.close();
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
    const aftersales = caps.canReportQuality;
    const specialist = caps.canAnalyzeQuality;
    const adminReadOnly = caps.baseRole === "admin";
    const planningManager = caps.baseRole === "manager"
      && (hasQualityPlanningHandoff(session.userId)
        || getAdminTestActor(session.userId)?.impersonationKind === "manager");
    const viewerUserId = readViewerUserId({ session, adminReadOnly, url });
    const projectionRequested = isQualityRolePanelsEnabled()
      && (url.searchParams.get("projection") === "1"
        || adminReadOnly
        || caps.roles.includes("aftersales_manager")
        || caps.hasQualityManagement);
    const panelContext = projectionRequested
      ? resolveQualityPerspectiveContext(perspectiveRequest(url, session))
      : null;
    const adminTestWrite = adminReadOnly
      && panelContext?.scope === "test"
      && panelContext.readonly === false
      && isQualityTestActorsEnabled();

    if (adminReadOnly && !adminTestWrite && req.method !== "GET" && req.method !== "HEAD") {
      writeJson(res, 403, {
        ok: false,
        error: "管理员业务视角仅供查看，不能执行质量业务写操作",
      });
      return;
    }

    const analysisMatch = url.pathname.match(
      /^\/api\/workbench\/quality\/events\/([^/]+)\/analysis(?:\/(generate|draft|confirm))?$/,
    );
    if (analysisMatch) {
      const eventId = decodeURIComponent(analysisMatch[1]!);
      const action = analysisMatch[2] ?? "workspace";
      const service = createQualityAnalysisService();
      try {
        if (req.method === "GET" && action === "workspace") {
          writeJson(res, 200, { ok: true, data: service.workspace({ eventId, viewerUserId }) });
          return;
        }
        if (req.method === "POST" && action === "generate") {
          const body = z.object({ requestId: z.string().uuid() }).strict().parse(await readJsonBody(req));
          const attempt = await service.generate({ eventId, actorUserId: session.userId, requestId: body.requestId });
          writeJson(res, 201, { ok: true, data: { attempt } });
          return;
        }
        if (req.method === "PUT" && action === "draft") {
          const draft = saveQualityAnalysisDraftSchema.parse(await readJsonBody(req));
          const saved = service.saveDraft({ eventId, actorUserId: session.userId, draft });
          writeJson(res, 200, { ok: true, data: { draft: saved } });
          return;
        }
        if (req.method === "POST" && action === "confirm") {
          const body = confirmQualityAnalysisSchema.parse(await readJsonBody(req));
          const result = service.confirm({ eventId, actorUserId: session.userId, ...body });
          writeJson(res, 201, { ok: true, data: result });
          return;
        }
        writeJson(res, 405, { ok: false, error: "请求方法不支持" });
        return;
      } finally {
        service.close();
      }
    }

    if (url.pathname === "/api/workbench/quality/review-queue") {
      if (!aftersales && !adminReadOnly) { forbidden(res); return; }
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
          actorRole: adminReadOnly
            ? "admin"
            : specialist
              ? "quality_specialist"
              : aftersales
                ? "aftersales_manager"
                : undefined,
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
      const readOnlyAdminRequest = adminReadOnly && req.method === "GET";
      if (!aftersales && !readOnlyAdminRequest) {
        forbidden(res);
        return;
      }
    } else if (!caps.canAccessTracking && !planningManager) {
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
            reviewStatus: z.enum([
              "PENDING",
              "REVIEWED",
              "REPORTED",
              "ACTION_REQUIRED",
              "COMPLETED",
            ])
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
        requestId: z.string().uuid().optional(),
      }).strict().parse(await readJsonBody(req));
      const result = await runQualitySourceAiAssessment({
        sourceKey: body.sourceKey,
        requestId: body.requestId,
        actorUserId: session.userId,
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
      const reviewService = createQualitySourceReviewService();
      try {
        const workspace = service.getReviewWorkspace(sourceKey);
        const review = reviewService.get(sourceKey);
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
            aiAssessment: workspace.aiAssessment,
            reportEvent: workspace.reportEvent,
            review,
            sourceUpdatedSinceAssessment: workspace.assessment != null
              && workspace.assessment.sourceVersion !== workspace.source.sourceVersion,
            sourceUpdatedSinceDecision: review != null
              && review.sourceContentHash !== workspace.source.normalizedFeedback.contentHash,
          },
        });
      } finally {
        reviewService.close();
        service.close();
      }
      return;
    }

    const sourceDispositionMatch = url.pathname.match(
      /^\/api\/workbench\/quality\/assessments\/([^/]+)\/disposition$/,
    );
    if (sourceDispositionMatch && req.method === "POST") {
      const sourceKey = decodeURIComponent(sourceDispositionMatch[1]!);
      const body = z.object({
        expectedAssessmentVersion: z.number().int().positive(),
        expectedReviewVersion: z.number().int().nonnegative(),
        requestId: z.string().uuid(),
        note: z.string().trim().max(2000).optional(),
      }).strict().parse(await readJsonBody(req));
      const assessmentService = createQualitySourceAssessmentService();
      const reviewService = createQualitySourceReviewService();
      try {
        const assessment = assessmentService.getAssessment(sourceKey);
        if (!assessment) throw new Error("主管最终研判不存在");
        if (assessment.version !== body.expectedAssessmentVersion) {
          throw new Error("version conflict");
        }
        if (assessment.handlingRecommendation === "QUALITY_ANOMALY") {
          throw new Error("质量异常必须由主管明确提交通报后进入质量流程");
        }
        const review = reviewService.reviewSource({
          actorUserId: session.userId,
          sourceKey,
          decision: assessment.handlingRecommendation,
          note: body.note,
          expectedVersion: body.expectedReviewVersion,
          assessmentVersion: body.expectedAssessmentVersion,
          requestId: body.requestId,
        });
        triggerQualitySourceWriteback();
        writeJson(res, 200, { ok: true, data: { review } });
      } finally {
        reviewService.close();
        assessmentService.close();
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
      if (projectionRequested) {
        const projector = createQualityEventPerspectiveProjector();
        try {
          const projected = projector.listEvents(perspectiveRequest(url, session));
          const query = (url.searchParams.get("q") ?? "").trim().toLocaleLowerCase("zh-CN");
          const requestedStatus = url.searchParams.get("status")?.trim().toUpperCase();
          const requestedStatusLabel = requestedStatus ? qualityStatusLabel(requestedStatus) : "";
          const requestedBucket = url.searchParams.get("bucket")?.trim().toUpperCase();
          const requestedRisk = url.searchParams.get("riskLevel")?.trim().toUpperCase();
          const events = projected.events.filter((event) => {
            if (requestedStatusLabel && event.statusLabel !== requestedStatusLabel) return false;
            if (requestedBucket && event.attentionBucket !== requestedBucket) return false;
            if (requestedRisk) {
              const expected = requestedRisk === "HIGH" ? "高"
                : requestedRisk === "MEDIUM" ? "中"
                  : requestedRisk === "LOW" ? "低" : "";
              if (expected && event.urgencyLabel !== expected) return false;
            }
            if (!query) return true;
            return [
              event.eventNumber,
              event.title,
              event.statusLabel,
              event.currentOwnerName,
              event.currentDepartmentName,
            ].some((value) => String(value).toLocaleLowerCase("zh-CN").includes(query));
          });
          const page = parsePositiveInt(url.searchParams.get("page"), 1);
          const pageSize = parsePositiveInt(url.searchParams.get("pageSize"), 50, 200);
          const start = (page - 1) * pageSize;
          writeJson(res, 200, {
            ok: true,
            data: {
              scope: projected.context.scope,
              perspective: projected.context.perspective,
              readonly: projected.context.readonly,
              events: events.slice(start, start + pageSize),
              stats: projected.stats,
              pagination: {
                page,
                pageSize,
                total: events.length,
                pageCount: Math.ceil(events.length / pageSize),
              },
            },
          });
        } finally {
          projector.close();
        }
        return;
      }
      const store = createQualityEventQuery();
      try {
        const query = (url.searchParams.get("q") ?? "").trim().toLocaleLowerCase("zh-CN");
        const status = url.searchParams.get("status")?.trim().toUpperCase();
        const statuses = new Set(
          String(url.searchParams.get("statuses") ?? "")
            .split(",")
            .map((item) => item.trim().toUpperCase())
            .filter(Boolean),
        );
        const managerStage = String(url.searchParams.get("managerStage") ?? "")
          .trim().toUpperCase() as QualityManagerMetricStage | "";
        const riskLevel = url.searchParams.get("riskLevel")?.trim().toUpperCase();
        const stageDb = managerStage
          ? new DatabaseSync(resolveWorkbenchSqlitePath(), { readOnly: true })
          : null;
        let events;
        try {
          events = store.listEvents({ viewerUserId }).filter((event) => {
            if (status && event.status !== status) return false;
            if (statuses.size > 0 && !statuses.has(event.status)) return false;
            if (managerStage && stageDb && qualityManagerMetricStage({
              db: stageDb,
              eventId: event.eventId,
              eventStatus: event.status,
              managerUserId: viewerUserId,
            }) !== managerStage) return false;
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
        } finally {
          stageDb?.close();
        }
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

    const supervisorOptions = url.pathname.match(
      /^\/api\/workbench\/quality\/events\/([^/]+)\/supervisor-options$/,
    );
    if (req.method === "GET" && supervisorOptions && projectionRequested) {
      const eventId = decodeURIComponent(supervisorOptions[1]!);
      const projected = projectedDetail(eventId, url, session);
      if (!projected || projected.context.perspective !== "quality_management") {
        throw new Error("quality action forbidden");
      }
      const qualityStore = createQualityStore();
      let event;
      try {
        event = qualityStore.getEvent(eventId);
      } finally {
        qualityStore.close();
      }
      if (!event) throw new Error("quality event not found");
      const directory = createQualitySupervisorDirectory();
      try {
        writeJson(res, 200, {
          ok: true,
          data: {
            departments: directory.listGroups({
              eventId,
              isTest: event.isTest,
              query: url.searchParams.get("q") ?? "",
            }),
          },
        });
      } finally {
        directory.close();
      }
      return;
    }

    const assignSupervisor = url.pathname.match(
      /^\/api\/workbench\/quality\/events\/([^/]+)\/assign-supervisor$/,
    );
    if (req.method === "POST" && assignSupervisor && projectionRequested) {
      const eventId = decodeURIComponent(assignSupervisor[1]!);
      const projected = projectedDetail(eventId, url, session);
      if (!projected || projected.context.perspective !== "quality_management" || projected.context.readonly) {
        throw new Error("quality action forbidden");
      }
      const body = await readJsonBody(req);
      const service = createQualityAssignmentService();
      try {
        await service.assignSupervisor({
          eventId,
          specialistUserId: projected.context.actorUserId,
          actualAdminUserId: projected.context.scope === "test" ? session.userId : undefined,
          candidateRef: z.string().trim().min(1).max(200).parse(body.candidateRef),
          dueAt: z.string().trim().min(1).max(64).parse(body.dueAt),
          taskRequirement: z.string().trim().min(1).max(5000).parse(body.taskRequirement),
          expectedVersion: z.number().int().positive().parse(body.expectedVersion),
          requestId: requestId(body.requestId),
        });
      } finally {
        service.close();
      }
      const updated = projectedDetail(eventId, url, session);
      writeJson(res, 201, { ok: true, data: { viewModel: updated?.viewModel } });
      return;
    }

    const testEmployeeOptions = url.pathname.match(
      /^\/api\/workbench\/quality\/events\/([^/]+)\/test-employee-options$/,
    );
    if (req.method === "GET" && testEmployeeOptions && projectionRequested) {
      const eventId = decodeURIComponent(testEmployeeOptions[1]!);
      const projected = projectedDetail(eventId, url, session);
      if (!projected || projected.context.scope !== "test"
        || projected.context.perspective !== "manager" || projected.context.readonly) {
        throw new Error("quality action forbidden");
      }
      const branch = (projected.viewModel as {
        branch?: Array<{ departmentName?: string; assigneeTypeLabel?: string }>;
      }).branch ?? [];
      const managerNode = branch.find((node) => node.assigneeTypeLabel === "主管");
      if (!managerNode?.departmentName) throw new Error("当前主管责任分支不可分配");
      const directory = createQualitySupervisorDirectory();
      try {
        writeJson(res, 200, {
          ok: true,
          data: {
            employees: directory.listTestEmployees({
              eventId,
              departmentName: managerNode.departmentName,
            }),
          },
        });
      } finally {
        directory.close();
      }
      return;
    }

    const testAction = url.pathname.match(
      /^\/api\/workbench\/quality\/events\/([^/]+)\/test-action$/,
    );
    if (req.method === "POST" && testAction && projectionRequested) {
      const eventId = decodeURIComponent(testAction[1]!);
      const projected = projectedDetail(eventId, url, session);
      if (!projected || projected.context.scope !== "test" || projected.context.readonly) {
        throw new Error("quality action forbidden");
      }
      const body = await readJsonBody(req);
      const action = z.enum([
        "generate-original-ai",
        "generate-analysis-ai",
        "update-aftersales",
        "complete-analysis",
        "accept", "reject", "delegate", "add-evidence", "submit-completion",
        "review-child", "primary-review",
      ]).parse(body.action);
      const viewModel = projected.viewModel as {
        allowedActions?: string[];
        branch?: Array<{
          actionRef: string;
          assigneeTypeLabel: string;
          departmentName: string;
          version: number;
        }>;
      };
      const allowed = new Set(viewModel.allowedActions ?? []);
      const requiredPermission = action === "add-evidence" ? "upload-evidence" : action;
      if (!allowed.has(requiredPermission)) throw new Error("quality action forbidden");
      if (action === "generate-original-ai" || action === "generate-analysis-ai") {
        const service = createQualityTestAiService();
        try {
          const common = {
            eventId,
            actualAdminUserId: session.userId,
            expectedVersion: z.number().int().positive().parse(body.expectedVersion),
            requestId: requestId(body.requestId),
          };
          if (action === "generate-original-ai") {
            if (projected.context.perspective !== "aftersales") {
              throw new Error("quality action forbidden");
            }
            await service.generateOriginal({
              ...common,
              testAftersalesUserId: projected.context.actorUserId,
            });
          } else {
            if (projected.context.perspective !== "quality_management") {
              throw new Error("quality action forbidden");
            }
            await service.generateInitialAnalysis({
              ...common,
              testSpecialistUserId: projected.context.actorUserId,
            });
          }
        } finally {
          service.close();
        }
        const updated = projectedDetail(eventId, url, session);
        writeJson(res, 200, { ok: true, data: { viewModel: updated?.viewModel } });
        return;
      }
      if (action === "update-aftersales") {
        if (projected.context.perspective !== "aftersales") {
          throw new Error("quality action forbidden");
        }
        const service = createQualityTestAftersalesService();
        try {
          service.update({
            eventId,
            testAftersalesUserId: projected.context.actorUserId,
            actualAdminUserId: session.userId,
            expectedVersion: z.number().int().positive().parse(body.expectedVersion),
            requestId: requestId(body.requestId),
            problemStatus: z.string().trim().min(1).max(10000).parse(body.problemStatus),
            initialCategory: z.string().trim().min(1).max(200).parse(body.initialCategory),
            urgency: z.enum(["LOW", "MEDIUM", "HIGH"]).parse(body.urgency),
            supplement: body.supplement == null
              ? ""
              : z.string().trim().max(10000).parse(body.supplement),
            reason: z.string().trim().min(1).max(1000).parse(body.reason),
          });
        } finally {
          service.close();
        }
        const updated = projectedDetail(eventId, url, session);
        writeJson(res, 200, { ok: true, data: { viewModel: updated?.viewModel } });
        return;
      }
      if (action === "complete-analysis") {
        if (projected.context.perspective !== "quality_management") {
          throw new Error("quality action forbidden");
        }
        const service = createQualityTestAnalysisService();
        try {
          service.complete({
            eventId,
            testSpecialistUserId: projected.context.actorUserId,
            actualAdminUserId: session.userId,
            expectedVersion: z.number().int().positive().parse(body.expectedVersion),
            requestId: requestId(body.requestId),
            problemDirection: z.string().trim().min(1).max(5000).parse(body.problemDirection),
            confirmedCategory: z.string().trim().min(1).max(1000).parse(body.confirmedCategory),
            sourceFactSummary: z.string().trim().min(1).max(10000).parse(body.sourceFactSummary),
            analysisBasis: z.string().trim().min(1).max(10000).parse(body.analysisBasis),
            preliminaryConclusion: z.string().trim().min(1).max(10000).parse(body.preliminaryConclusion),
            informationGaps: body.informationGaps == null
              ? undefined
              : z.string().trim().max(5000).parse(body.informationGaps),
            handlingRequirements: z.string().trim().min(1).max(10000).parse(body.handlingRequirements),
            suggestedDueAt: z.string().trim().min(1).max(64).parse(body.suggestedDueAt),
            deliverableName: z.string().trim().min(1).max(500).parse(body.deliverableName),
            deliverableDescription: z.string().trim().min(1).max(5000).parse(body.deliverableDescription),
            acceptanceCriteria: z.string().trim().min(1).max(5000).parse(body.acceptanceCriteria),
          });
        } finally {
          service.close();
        }
        const updated = projectedDetail(eventId, url, session);
        writeJson(res, 200, { ok: true, data: { viewModel: updated?.viewModel } });
        return;
      }
      if (!["manager", "employee"].includes(projected.context.perspective)) {
        throw new Error("quality action forbidden");
      }
      const branch = viewModel.branch ?? [];
      const actorNode = branch.find((node) =>
        projected.context.perspective === "manager"
          ? node.assigneeTypeLabel === "主管"
          : node.assigneeTypeLabel === "员工",
      );
      if (!actorNode) throw new Error("记录不存在或无权访问");
      if (action === "accept" || action === "reject") {
        const service = createQualityAssignmentService();
        try {
          const common = {
            nodeId: actorNode.actionRef,
            actorUserId: projected.context.actorUserId,
            actualAdminUserId: session.userId,
            expectedVersion: z.number().int().positive().parse(body.expectedVersion),
            requestId: requestId(body.requestId),
          };
          if (action === "accept") await service.acceptNode(common);
          else await service.rejectNode({
            ...common,
            reason: z.string().trim().min(1).max(1000).parse(body.reason),
          });
        } finally {
          service.close();
        }
      } else if (action === "delegate") {
        if (projected.context.perspective !== "manager") throw new Error("quality action forbidden");
        const directory = createQualitySupervisorDirectory();
        const employee = directory.resolveTestEmployee({
          eventId,
          departmentName: actorNode.departmentName,
          candidateRef: z.string().trim().min(1).max(200).parse(body.candidateRef),
        });
        directory.close();
        if (!employee) throw new Error("测试员工候选无效");
        const service = createQualityAssignmentService();
        try {
          await service.delegateNode({
            parentNodeId: actorNode.actionRef,
            actorUserId: projected.context.actorUserId,
            assigneeUserId: employee.userId,
            assigneeKind: "EMPLOYEE",
            departmentName: employee.departmentName,
            dueAt: z.string().trim().min(1).max(64).parse(body.dueAt),
            requirement: z.string().trim().min(1).max(5000).parse(body.requirement),
            expectedVersion: z.number().int().positive().parse(body.expectedVersion),
            requestId: requestId(body.requestId),
            actualAdminUserId: session.userId,
          });
        } finally {
          service.close();
        }
      } else if (action === "add-evidence") {
        const summary = z.string().trim().min(1).max(2000).parse(body.summary);
        const service = createQualityEvidenceService();
        try {
          service.uploadEvidence({
            nodeId: actorNode.actionRef,
            actorUserId: projected.context.actorUserId,
            actualAdminUserId: session.userId,
            originalName: "测试证据说明.txt",
            mimeType: "text/plain",
            summary,
            buffer: Buffer.from(`${summary}\n`, "utf8"),
            requestId: requestId(body.requestId),
          });
        } finally {
          service.close();
        }
      } else if (action === "submit-completion") {
        const service = createQualityEvidenceService();
        try {
          service.submitCompletion({
            nodeId: actorNode.actionRef,
            actorUserId: projected.context.actorUserId,
            actualAdminUserId: session.userId,
            expectedVersion: z.number().int().positive().parse(body.expectedVersion),
            requestId: requestId(body.requestId),
          });
        } finally {
          service.close();
        }
      } else if (action === "review-child") {
        if (projected.context.perspective !== "manager") throw new Error("quality action forbidden");
        const childActionRef = z.string().trim().min(1).max(300).parse(body.childActionRef);
        const child = branch.find((node) =>
          node.actionRef === childActionRef && node.assigneeTypeLabel === "员工",
        );
        if (!child) throw new Error("记录不存在或无权访问");
        const service = createQualityReviewService();
        try {
          service.reviewDirectChild({
            childNodeId: child.actionRef,
            actorUserId: projected.context.actorUserId,
            actualAdminUserId: session.userId,
            decision: z.enum(["APPROVE", "RETURN"]).parse(body.decision),
            reason: body.reason == null
              ? undefined
              : z.string().trim().max(2000).parse(body.reason),
            expectedVersion: z.number().int().positive().parse(body.expectedVersion),
            requestId: requestId(body.requestId),
          });
        } finally {
          service.close();
        }
      } else {
        if (projected.context.perspective !== "manager") throw new Error("quality action forbidden");
        const service = createQualityReviewService();
        try {
          service.primaryReview({
            eventId,
            primaryManagerUserId: projected.context.actorUserId,
            actualAdminUserId: session.userId,
            decision: "APPROVE",
            expectedVersion: z.number().int().positive().parse(body.expectedVersion),
            requestId: requestId(body.requestId),
          });
        } finally {
          service.close();
        }
      }
      const updated = projectedDetail(eventId, url, session);
      writeJson(res, 200, { ok: true, data: { viewModel: updated?.viewModel } });
      return;
    }

    const specialistAction = url.pathname.match(/^\/api\/workbench\/quality\/events\/([^/]+)\/(assign-primary|due|return-node|close|reopen)$/);
    if (req.method === "POST" && specialistAction) {
      const eventId = decodeURIComponent(specialistAction[1]!);
      const action = specialistAction[2]!;
      const projected = projectionRequested ? projectedDetail(eventId, url, session) : null;
      const testSpecialist = projected?.context.scope === "test"
        && projected.context.perspective === "quality_management"
        && !projected.context.readonly;
      if (!specialist && !testSpecialist) throw new Error("仅质量专员可执行该操作");
      const specialistUserId = testSpecialist ? projected!.context.actorUserId : session.userId;
      const actualAdminUserId = testSpecialist ? session.userId : undefined;
      const body = await readJsonBody(req);
      if (action === "assign-primary" || action === "due") {
        if (testSpecialist) throw new Error("测试视角请使用主管选择器");
        const service = createQualityAssignmentService();
        try {
          if (action === "assign-primary") {
            const result = await service.assignPrimary({
              eventId,
              specialistUserId,
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
              specialistUserId,
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
            eventId, nodeId: z.string().trim().min(1).max(300).parse(body.nodeId), specialistUserId,
            actualAdminUserId,
            reason: z.string().trim().min(1).max(2000).parse(body.reason), expectedVersion: parsePositiveInt(body.expectedVersion, 0), requestId: requestId(body.requestId),
          });
          writeJson(res, 200, { ok: true, data: result });
        } else if (action === "close") {
          const event = service.closeEvent({
            eventId, specialistUserId, actualAdminUserId,
            conclusion: z.string().trim().min(1).max(10000).parse(body.conclusion),
            expectedVersion: parsePositiveInt(body.expectedVersion, 0), requestId: requestId(body.requestId),
          });
          writeJson(res, 200, { ok: true, data: { event } });
        } else {
          const result = service.reopenEvent({
            eventId, nodeId: z.string().trim().min(1).max(300).parse(body.nodeId), specialistUserId,
            actualAdminUserId,
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
          ? body.assessmentVersion == null
            ? service.createDraftFromSources({
            actor: actorFor(session, "aftersales_manager"),
            requestId: requestId(body.requestId),
            sourceKeys: keys,
            overrides: body.draft == null
              ? undefined
              : qualityDraftFieldsSchema.partial().parse(body.draft),
            })
            : service.createDraftFromAssessment({
              actor: actorFor(session, "aftersales_manager"),
              requestId: requestId(body.requestId),
              sourceKey: z.tuple([z.string().trim().min(1).max(300)]).parse(keys)[0],
              expectedAssessmentVersion: z.number().int().positive().parse(body.assessmentVersion),
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
          if (body.assessmentVersion != null
            && result.event.status === "DRAFT"
            && result.event.createdBy === session.userId) {
            writeJson(res, 200, {
              ok: true,
              data: { created: false, event: result.event, sourceSnapshots },
            });
            return;
          }
          writeJson(res, 409, {
            ok: false,
            error: "该来源已经通报",
            data: { existingEventId: result.event.eventId, event: result.event, sourceSnapshots },
          });
          return;
        }
        writeJson(res, 201, {
          ok: true,
          data: { created: true, event: result.event, sourceSnapshots },
        });
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
        if (projectionRequested) {
          const projected = projectedDetail(eventId, url, session);
          if (!projected) {
            writeJson(res, 404, { ok: false, error: "记录不存在或无权访问" });
            return;
          }
          writeJson(res, 200, { ok: true, data: { viewModel: projected.viewModel } });
          return;
        }
        const detailSession = viewerUserId === session.userId
          ? session
          : { ...session, userId: viewerUserId };
        const detail = detailForActor(eventId, detailSession);
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
            description: z.string().trim().max(2000).optional().parse(upload.fields.description),
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
      const role = adminReadOnly
        ? "admin"
        : specialist
          ? "quality_specialist"
          : "aftersales_manager";
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
    let response = errorResponse(error);
    const errorCaps = resolveQualityCapabilities(session.userId);
    if (isQualityRolePanelsEnabled()
      && (url.searchParams.get("projection") === "1"
        || errorCaps.baseRole === "admin"
        || errorCaps.roles.includes("aftersales_manager")
        || errorCaps.hasQualityManagement)) {
      response = projectedErrorResponse(response);
    }
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
  const planningManager = caps.baseRole === "manager"
    && (hasQualityPlanningHandoff(session.userId)
      || getAdminTestActor(session.userId)?.impersonationKind === "manager");
  const managerPerspectives = caps.baseRole === "admin"
    ? listQualityManagerPerspectives()
    : [];
  const requestedManagerUserId = caps.baseRole === "admin"
    ? String(url.searchParams.get("managerUserId") ?? "").trim()
    : "";
  const selectedManager = requestedManagerUserId
    ? managerPerspectives.find((item) => item.managerUserId === requestedManagerUserId)
    : undefined;
  const rolePanelsEnabled = isQualityRolePanelsEnabled();
  const testActorsEnabled = isQualityTestActorsEnabled();
  const requestedTestActorRaw = String(url.searchParams.get("testActor") ?? "").trim();
  const requestedTestActor = caps.baseRole === "admin" && rolePanelsEnabled && testActorsEnabled
    ? resolveQualityTestActor(requestedTestActorRaw)?.actorRef ?? "aftersales"
    : "";
  const requestedPerspective = caps.baseRole === "admin" && rolePanelsEnabled
    ? String(url.searchParams.get("perspective") ?? "").trim()
    : "";
  const pagePerspective = caps.baseRole === "admin" && rolePanelsEnabled
    ? resolveQualityPerspectiveContext({
        viewerUserId: session.userId,
        perspective: requestedPerspective as QualityPerspectiveRequest["perspective"],
        testActorRef: requestedTestActor || null,
      })
    : null;

  if ((req.method === "GET" || isHead)
    && (url.pathname === "/workbench/quality"
      || url.pathname === "/workbench/quality/review")) {
    if ((!caps.canAccessTracking && !planningManager)
      || (requestedManagerUserId && !selectedManager)
      || (caps.baseRole !== "admin"
        && url.pathname === "/workbench/quality/review"
        && !caps.roles.includes("aftersales_manager"))) {
      forbidden(res);
      return true;
    }
    const html = renderQualityTrackingPage({
      role: session.role as WorkbenchShellRole,
      userId: session.userId,
      userLabel: session.dingUser?.name,
      canReport: pagePerspective ? false : caps.canReportQuality,
      canViewSources: pagePerspective
        ? pagePerspective.scope === "real" && pagePerspective.perspective === "aftersales"
        : caps.canReportQuality || caps.baseRole === "admin",
      isSpecialist: pagePerspective
        ? pagePerspective.perspective === "quality_management"
        : caps.canAnalyzeQuality,
      isBusinessReadOnly: pagePerspective
        ? pagePerspective.readonly
        : caps.baseRole === "admin" || caps.isBusinessReadOnly,
      planningMode: pagePerspective
        ? pagePerspective.perspective === "manager" || pagePerspective.perspective === "employee"
        : planningManager || Boolean(selectedManager),
      managerPerspectives,
      selectedManagerUserId: selectedManager?.managerUserId,
      rolePanelsEnabled,
      testActorsEnabled,
      isAdmin: caps.baseRole === "admin",
      activePerspective: pagePerspective?.perspective,
      activeTestActor: requestedTestActor,
      projectedMode: pagePerspective != null
        || (rolePanelsEnabled
          && (caps.hasQualityManagement || caps.roles.includes("aftersales_manager"))),
      reviewSourceKey: url.pathname === "/workbench/quality/review"
        ? url.searchParams.get("sourceKey") ?? ""
        : undefined,
    });
    res.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store, must-revalidate",
    });
    const pageHtml = caps.baseRole === "admin" && rolePanelsEnabled && testActorsEnabled
      ? html
      : decorateWorkbenchHtmlForAdminImpersonation(html, session);
    res.end(isHead ? "" : pageHtml);
    return true;
  }

  if ((req.method === "GET" || isHead) && url.pathname === "/workbench/quality/review") {
    if (!caps.canReportQuality) {
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
    res.end(isHead ? "" : decorateWorkbenchHtmlForAdminImpersonation(html, session));
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
      isSpecialist: caps.canAnalyzeQuality,
    });
    res.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store, must-revalidate",
    });
    res.end(isHead ? "" : decorateWorkbenchHtmlForAdminImpersonation(html, session));
    return true;
  }

  void handleQualityApi(input);
  return true;
}
