import { WORKBENCH_APP_BASE_CSS } from "./workbench-app-styles";
import { buildWorkbenchViewSwitchClientJs } from "./workbench-view-switch-snippet";
import { isTaskIntakeEnabled } from "../agent/task-intake/task-intake-flag";
import { isDailyReportsPageEnabled } from "../agent/daily-report-digest/daily-reports-page-flag";
import { isMeetingImportEnabled } from "../agent/meeting-import/meeting-import-flag";
import { isCompetencyEvalUser } from "../agent/competency-eval/competency-eval-access";
import { isCompetencyEvalEnabled } from "../agent/competency-eval/competency-eval-flag";
import { resolveQualityCapabilities } from "../security/quality-capabilities";
import { resolveWorkbenchCapabilities } from "../security/workbench-capabilities";
import {
  adminPerspectiveLabel,
  type WorkbenchAdminPerspective,
} from "../security/workbench-admin-perspective";

function resolveCompetencyEvalNavEnabled(params: {
  sessionUserId?: string;
  competencyEvalEnabled?: boolean;
}): boolean {
  if (params.competencyEvalEnabled !== undefined) return params.competencyEvalEnabled;
  const id = String(params.sessionUserId ?? "").trim();
  if (!id) return false;
  return isCompetencyEvalEnabled() && isCompetencyEvalUser(id);
}

export type WorkbenchShellRole = "manager" | "employee" | "admin";

export type WorkbenchNavId =
  | "mgr-tasks"
  | "mgr-dash"
  | "mgr-perf"
  | "mgr-daily-reports"
  | "mgr-chat"
  | "mgr-proj"
  | "mgr-meeting-import"
  | "mgr-task-intake"
  | "mgr-competency-eval"
  | "emp-new"
  | "emp-cur"
  | "emp-hist"
  | "emp-daily-reports"
  | "emp-prof"
  | "emp-security"
  | "adm-tasks"
  | "adm-perms"
  | "adm-ops"
  | "adm-daily-reports"
  | "adm-perf"
  | "quality-tracking"
  | "quality-opinions";

function escapeHtml(v: string): string {
  return v
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function railLink(
  href: string,
  label: string,
  navId: WorkbenchNavId,
  activeNav: WorkbenchNavId,
  role: WorkbenchShellRole,
  opts?: { badge?: string; badgeTone?: "blue" | "green" | "amber"; hidden?: boolean; id?: string },
): string {
  const on = activeNav === navId;
  const cls = [
    "wb-rail-link",
    on && role === "manager" ? "is-on" : "",
    on && role === "employee" ? "is-on-emp" : "",
    on && role === "admin" ? "is-on-adm" : "",
  ]
    .filter(Boolean)
    .join(" ");
  const badge =
    opts?.badge != null
      ? `<span class="wb-rail-badge${opts.badgeTone === "green" ? " is-green" : opts.badgeTone === "amber" ? " is-amber" : ""}">${escapeHtml(opts.badge)}</span>`
      : "";
  const hidden = opts?.hidden ? " hidden" : "";
  const idAttr = opts?.id ? ` id="${escapeHtml(opts.id)}"` : "";
  return `<a class="${cls}" href="${href}" data-wb-nav="${navId}"${idAttr}${hidden}>${escapeHtml(label)}${badge}</a>`;
}

function buildManagerRail(
  activeNav: WorkbenchNavId,
  portfolioEnabled: boolean,
  competencyEvalEnabled = false,
  adminPerspective?: WorkbenchAdminPerspective,
): string {
  const href = (path: string, navId: WorkbenchNavId): string =>
    adminPerspective && adminPerspective !== "operations"
      ? `/workbench/admin/perspective?view=${encodeURIComponent(adminPerspective)}&section=${encodeURIComponent(navId)}`
      : path;
  const portfolioLinks = portfolioEnabled
    ? `${railLink(href("/workbench/manager/projects", "mgr-proj"), "项目总览", "mgr-proj", activeNav, "manager")}`
    : "";
  return `<div class="wb-rail-grp">
  <div class="wb-rail-grp-lbl">工作</div>
  ${railLink(href("/workbench/manager/tasks", "mgr-tasks"), "历史任务", "mgr-tasks", activeNav, "manager")}
  ${railLink(href("/workbench/manager/dashboard", "mgr-dash"), "周度看板", "mgr-dash", activeNav, "manager")}
  ${railLink(href("/workbench/manager/performance", "mgr-perf"), "交付绩效", "mgr-perf", activeNav, "manager")}
  ${isDailyReportsPageEnabled() ? railLink(href("/workbench/manager/daily-reports", "mgr-daily-reports"), "日报汇总", "mgr-daily-reports", activeNav, "manager") : ""}
  ${competencyEvalEnabled ? railLink(href("/workbench/manager/competency-eval", "mgr-competency-eval"), "能力评估", "mgr-competency-eval", activeNav, "manager") : ""}
  ${railLink(href("/workbench/manager/chat?thread=main", "mgr-chat"), "智能规划助手", "mgr-chat", activeNav, "manager")}
  ${isTaskIntakeEnabled() ? railLink(href("/workbench/manager/task-intake", "mgr-task-intake"), "任务快录入库", "mgr-task-intake", activeNav, "manager") : ""}
</div>
${
  portfolioEnabled
    ? `<div class="wb-rail-grp">
  <div class="wb-rail-grp-lbl">项目管理主管</div>
  ${portfolioLinks}
  ${isMeetingImportEnabled() ? railLink(href("/workbench/manager/meeting-import", "mgr-meeting-import"), "会议入库", "mgr-meeting-import", activeNav, "manager") : ""}
</div>`
    : ""
}`;
}

function buildEmployeeRail(
  activeNav: WorkbenchNavId,
  adminPerspective?: WorkbenchAdminPerspective,
): string {
  const href = (path: string, navId: WorkbenchNavId): string =>
    adminPerspective && adminPerspective !== "operations"
      ? `/workbench/admin/perspective?view=${encodeURIComponent(adminPerspective)}&section=${encodeURIComponent(navId)}`
      : path;
  return `<div class="wb-rail-grp">
  <div class="wb-rail-grp-lbl">我的</div>
  ${railLink(href("/workbench/employee?view=new", "emp-new"), "待承接", "emp-new", activeNav, "employee", { id: "navNew" })}
  ${railLink(href("/workbench/employee?view=current", "emp-cur"), "进行中", "emp-cur", activeNav, "employee", { id: "navCur" })}
  ${railLink(href("/workbench/employee?view=history", "emp-hist"), "已完成", "emp-hist", activeNav, "employee", { id: "navHist" })}
  ${isDailyReportsPageEnabled() ? railLink(href("/workbench/employee/daily-reports", "emp-daily-reports"), "日报汇总", "emp-daily-reports", activeNav, "employee") : ""}
  ${railLink(href("/workbench/employee?view=profile", "emp-prof"), "能力画像", "emp-prof", activeNav, "employee", { id: "navProf" })}
</div>`;
}

function buildAdminRail(activeNav: WorkbenchNavId, competencyEvalEnabled = false): string {
  return `<div class="wb-rail-grp">
  <div class="wb-rail-grp-lbl">全局</div>
  ${railLink("/workbench/admin", "任务总览", "adm-tasks", activeNav, "admin")}
  ${railLink("/workbench/admin/ops", "运营看板", "adm-ops", activeNav, "admin")}
  ${railLink("/workbench/admin/performance", "交付绩效", "adm-perf", activeNav, "admin")}
  ${isDailyReportsPageEnabled() ? railLink("/workbench/admin/daily-reports", "日报汇总", "adm-daily-reports", activeNav, "admin") : ""}
  ${competencyEvalEnabled ? railLink("/workbench/manager/competency-eval", "能力评估", "mgr-competency-eval", activeNav, "admin") : ""}
  ${railLink("/workbench/admin/permissions", "权限中心", "adm-perms", activeNav, "admin", { id: "navAdminPerms" })}
</div>`;
}

function buildQualityRail(params: {
  activeNav: WorkbenchNavId;
  role: WorkbenchShellRole;
  sessionUserId?: string;
  disabled?: boolean;
  adminPerspective?: WorkbenchAdminPerspective;
}): string {
  if (params.disabled) return "";
  const caps = resolveQualityCapabilities(String(params.sessionUserId ?? ""));
  const adminQualityPerspective = params.adminPerspective === "project_manager"
    || params.adminPerspective === "quality_specialist";
  const canShowTracking = params.adminPerspective
    ? adminQualityPerspective
    : caps.canReportQuality || caps.canAnalyzeQuality;
  if (!canShowTracking) return "";
  const href = params.adminPerspective
    ? `/workbench/quality?perspective=${encodeURIComponent(params.adminPerspective)}`
    : "/workbench/quality";
  return `<div class="wb-rail-grp">
  <div class="wb-rail-grp-lbl">质量</div>
  ${railLink(href, "质量追踪", "quality-tracking", params.activeNav, params.role)}
</div>`;
}

function roleMeta(
  role: WorkbenchShellRole,
  perspective?: WorkbenchAdminPerspective,
): { mark: string; subtitle: string; markClass: string } {
  if (perspective === "project_manager") {
    return { mark: "项", subtitle: "项目主管视角", markClass: "is-project" };
  }
  if (perspective === "quality_specialist") {
    return { mark: "质", subtitle: "质量专员视角", markClass: "is-quality" };
  }
  if (role === "employee") {
    return { mark: "员", subtitle: "员工工作台", markClass: "is-emp" };
  }
  if (role === "admin") {
    return { mark: "管", subtitle: "管理员", markClass: "is-adm" };
  }
  return { mark: "任", subtitle: "主管工作台", markClass: "" };
}

function roleSwitchHtml(
  currentPerspective: WorkbenchAdminPerspective,
  compact = false,
): string {
  const sm = compact ? " btn-sm" : "";
  const item = (perspective: WorkbenchAdminPerspective): string => {
    const label = adminPerspectiveLabel(perspective);
    if (perspective === currentPerspective) {
      return `<span class="wb-view-switch-item is-current" role="menuitem" aria-current="page"><span class="wb-view-switch-dot" aria-hidden="true"></span><span>${label}</span><small>当前</small></span>`;
    }
    return `<a class="wb-view-switch-item" role="menuitem" href="#" data-wb-view="${perspective}"><span class="wb-view-switch-dot" aria-hidden="true"></span><span>${label}</span></a>`;
  };
  return `<details class="wb-admin-view-switch">
  <summary class="btn wb-role-switch wb-role-switch--to-adm${sm}" aria-label="切换管理员查看视角" aria-haspopup="menu"><span class="wb-role-switch-ico" aria-hidden="true">⇄</span><span class="wb-role-switch-txt">${adminPerspectiveLabel(currentPerspective)}</span><span class="wb-view-switch-chevron" aria-hidden="true">▾</span></summary>
  <div class="wb-view-switch-menu" role="menu" aria-label="管理员查看视角">
    ${item("manager")}${item("project_manager")}${item("employee")}${item("quality_specialist")}${item("operations")}
  </div>
</details>`;
}

function defaultHeadActionsHtml(
  isAdminIdentity: boolean,
  currentPerspective: WorkbenchAdminPerspective,
): string {
  const logout = `<button type="button" class="btn btn-ghost btn-sm wb-appbar-logout" id="logoutBtn">退出</button>`;
  const readonly = isAdminIdentity && currentPerspective !== "operations"
    ? `<span class="wb-admin-readonly-badge">只读</span>`
    : "";
  return `${readonly}${isAdminIdentity ? roleSwitchHtml(currentPerspective, true) : ""}${logout}`;
}

function buildAppBar(
  role: WorkbenchShellRole,
  headActionsHtml: string,
  perspective?: WorkbenchAdminPerspective,
): string {
  const meta = roleMeta(role, perspective);
  return `<header class="wb-appbar" role="banner">
  ${railToggleBtn()}
  <div class="wb-appbar-brand">
    <span class="wb-appbar-mark ${meta.markClass}">${meta.mark}</span>
    <span class="wb-appbar-brand-txt">任务工作台</span>
  </div>
  <div class="wb-appbar-spacer" aria-hidden="true"></div>
  <div class="wb-appbar-actions">${headActionsHtml}</div>
</header>`;
}

function railToggleBtn(extraClass = ""): string {
  return `<button type="button" class="wb-rail-toggle btn btn-ghost btn-sm${extraClass ? ` ${extraClass}` : ""}" aria-label="打开导航菜单" aria-expanded="false" aria-controls="wbRailNav">
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16"/></svg>
  <span class="wb-rail-toggle-lbl">菜单</span>
</button>`;
}

export function buildWorkbenchShellClientJs(): string {
  return `<script>
${buildWorkbenchViewSwitchClientJs()}
</script>
<script>
(function () {
  var KEY = 'wb-rail-open';
  var MOBILE_MQ = window.matchMedia('(max-width: 767px)');
  var body = document.body;
  var backdrop = document.querySelector('.wb-rail-backdrop');
  function isMobile() { return MOBILE_MQ.matches; }
  function setOpen(open) {
    body.classList.toggle('wb-rail-is-open', open);
    if (!isMobile()) {
      try { localStorage.setItem(KEY, open ? '1' : '0'); } catch (e0) {}
    }
    document.querySelectorAll('.wb-rail-toggle').forEach(function (btn) {
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      btn.setAttribute('aria-label', open ? '收起导航菜单' : '打开导航菜单');
    });
    if (backdrop) backdrop.hidden = !open;
    body.classList.toggle('wb-rail-open-lock', open && isMobile());
  }
  function toggle() { setOpen(!body.classList.contains('wb-rail-is-open')); }
  function loadOpen() {
    if (isMobile()) return false;
    try { return localStorage.getItem(KEY) === '1'; } catch (e1) { return false; }
  }
  setOpen(loadOpen());
  document.querySelectorAll('.wb-rail-toggle').forEach(function (btn) {
    btn.addEventListener('click', function (ev) {
      ev.preventDefault();
      toggle();
    });
  });
  if (backdrop) {
    backdrop.addEventListener('click', function () { setOpen(false); });
  }
  document.addEventListener('keydown', function (ev) {
    if (ev.key === 'Escape' && body.classList.contains('wb-rail-is-open')) setOpen(false);
  });
  var railClose = document.querySelector('.wb-rail-close');
  if (railClose) {
    railClose.addEventListener('click', function () { setOpen(false); });
  }
  document.querySelectorAll('.wb-rail-link').forEach(function (link) {
    link.addEventListener('click', function () { setOpen(false); });
  });
  if (typeof MOBILE_MQ.addEventListener === 'function') {
    MOBILE_MQ.addEventListener('change', function () {
      if (isMobile()) setOpen(false);
      else setOpen(loadOpen());
    });
  } else if (typeof MOBILE_MQ.addListener === 'function') {
    MOBILE_MQ.addListener(function () {
      if (isMobile()) setOpen(false);
      else setOpen(loadOpen());
    });
  }
})();
</script>`;
}

export function renderWorkbenchPage(params: {
  role: WorkbenchShellRole;
  activeNav: WorkbenchNavId;
  title: string;
  pageTitle: string;
  description?: string;
  breadcrumbHtml?: string;
  headActionsHtml?: string;
  headToolbarHtml?: string;
  userLabel?: string;
  sessionUserId?: string;
  portfolioEnabled?: boolean;
  showAdminOpsLink?: boolean;
  competencyEvalEnabled?: boolean;
  canExecuteAsManager?: boolean;
  adminPerspective?: WorkbenchAdminPerspective;
  qualityAccessDisabled?: boolean;
  bodyClass?: string;
  mainClass?: string;
  mainBodyClass?: string;
  hideMainHead?: boolean;
  extraCss?: string;
  mainHtml: string;
  scriptHtml?: string;
}): string {
  const competencyEvalEnabled = resolveCompetencyEvalNavEnabled(params);
  const identityCaps = params.sessionUserId
    ? resolveWorkbenchCapabilities(params.sessionUserId)
    : undefined;
  const isAdminIdentity = Boolean(identityCaps?.canAccessAdmin);
  const currentPerspective: WorkbenchAdminPerspective = params.adminPerspective
    ?? (params.role === "manager" ? "manager" : params.role === "employee" ? "employee" : "operations");
  const baseRailNav =
    params.role === "manager"
      ? buildManagerRail(
        params.activeNav,
        Boolean(params.portfolioEnabled),
        competencyEvalEnabled,
        isAdminIdentity ? currentPerspective : undefined,
      )
      : params.role === "employee"
        ? buildEmployeeRail(params.activeNav, isAdminIdentity ? currentPerspective : undefined)
        : buildAdminRail(params.activeNav, competencyEvalEnabled);
  const railNav = `${baseRailNav}${buildQualityRail({
    activeNav: params.activeNav,
    role: params.role,
    sessionUserId: params.sessionUserId,
    disabled: params.qualityAccessDisabled,
    adminPerspective: isAdminIdentity ? currentPerspective : undefined,
  })}`;

  const descBlock = params.description
    ? `<p class="wb-main-desc">${escapeHtml(params.description)}</p>`
    : "";
  const crumbBlock =
    params.role === "employee"
      ? ""
      : params.breadcrumbHtml
        ? `<div class="wb-crumb">${params.breadcrumbHtml}</div>`
        : `<div class="wb-crumb">${escapeHtml(params.title)}</div>`;
  const headActions =
    params.headActionsHtml
    ?? defaultHeadActionsHtml(
      isAdminIdentity,
      currentPerspective,
    );
  const toolbar = params.headToolbarHtml ? `<div class="wb-main-toolbar">${params.headToolbarHtml}</div>` : "";

  const pageHead = params.hideMainHead
    ? ""
    : `<header class="wb-page-head">
  <div class="wb-page-head-inner">
    ${crumbBlock}
    <h1 class="wb-main-title"${params.role === "employee" ? ' id="empPageTitle"' : ""}>${escapeHtml(params.title)}</h1>
    ${descBlock}
    ${toolbar}
  </div>
</header>`;

  const bodyClass = [
    "wb-has-rail",
    isAdminIdentity && currentPerspective !== "operations" ? "wb-admin-readonly-preview" : "",
    params.bodyClass ?? "",
  ].filter(Boolean).join(" ");
  const mainClass = ["wb-main", params.mainClass ?? ""].filter(Boolean).join(" ");
  const mainBodyClass = ["wb-main-body", params.mainBodyClass ?? ""].filter(Boolean).join(" ");

  return `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(params.pageTitle)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700&display=swap" rel="stylesheet">
<style>${WORKBENCH_APP_BASE_CSS}${params.extraCss ?? ""}</style>
</head>
<body class="${bodyClass}">
<div class="wb-app">
  ${buildAppBar(params.role, headActions, isAdminIdentity ? currentPerspective : undefined)}
  <aside class="wb-rail" id="wbRailNav" aria-label="工作台导航">
    <div class="wb-rail-head">
      <div class="wb-rail-grp-lbl wb-rail-head-lbl">导航</div>
      <button type="button" class="wb-rail-close btn btn-ghost btn-sm" aria-label="收起导航">×</button>
    </div>
    <nav class="wb-rail-nav">${railNav}</nav>
  </aside>
  <div class="wb-rail-backdrop" hidden aria-hidden="true"></div>
  <div class="${mainClass}">
    ${pageHead}
    <div class="${mainBodyClass}">
      ${params.mainHtml}
    </div>
  </div>
</div>
${buildWorkbenchShellClientJs()}
${params.scriptHtml ?? ""}
</body>
</html>`;
}

/** Task detail / events: shell with breadcrumb; main content only inside body. */
export function renderWorkbenchDetailPage(params: {
  roleLabel: "admin" | "manager" | "employee";
  pageTitle: string;
  title: string;
  breadcrumbHtml: string;
  headToolbarHtml?: string;
  infoBarHtml?: string;
  enforceActionGuards: boolean;
  mainHtml: string;
  scriptHtml: string;
  userLabel?: string;
  sessionUserId?: string;
}): string {
  const role: WorkbenchShellRole =
    params.roleLabel === "admin" ? "admin" : params.roleLabel === "employee" ? "employee" : "manager";
  const activeNav: WorkbenchNavId =
    params.roleLabel === "admin"
      ? "adm-tasks"
      : params.roleLabel === "employee"
        ? "emp-new"
        : "mgr-tasks";

  return renderWorkbenchPage({
    role,
    activeNav,
    title: params.title,
    pageTitle: params.pageTitle,
    breadcrumbHtml: params.breadcrumbHtml,
    headToolbarHtml: params.headToolbarHtml,
    userLabel: params.userLabel,
    sessionUserId: params.sessionUserId,
    hideMainHead: false,
    mainBodyClass: params.roleLabel === "employee" ? "wb-main-body--detail-emp" : "wb-main-body--detail",
    mainHtml: `${params.infoBarHtml ?? ""}${params.mainHtml}`,
    scriptHtml: params.scriptHtml,
  });
}
