import { renderWorkbenchPage } from "./workbench-shell";
import { buildWorkbenchContactComboClientJs } from "./workbench-contact-combo-snippet";
import { buildWorkbenchFmtTimeClientJs } from "./workbench-datetime";
import {
  buildWorkbenchTasksPortfolioClientJs,
  WORKBENCH_TASKS_PORTFOLIO_CSS,
} from "./workbench-tasks-portfolio-snippet";
import { WORKBENCH_TASKS_FILTER_UNIFIED_CSS } from "./workbench-project-overview-styles";
import { buildWorkbenchViewSwitchClientJs } from "./workbench-view-switch-snippet";
import { hasQualityAssignmentNodesForUser } from "../quality/infra/quality-read-store";
import { MANAGER_CHAT_V2_CSS } from "./manager-chat-v2-styles";

export const QUALITY_TASK_REPLAN_MESSAGE =
  "请结合质量事件背景和质量初析，重新规划完整执行任务。必须覆盖已选的全部成果，但不要把一个成果简单等同于一个任务；补全执行步骤、交付物、验收标准、截止和前后依赖。只生成待确认草案，不要发放。";

export function shouldOfferQualityTaskReplan(input: {
  threadKind: "main" | "side";
  sourceContextKind?: string | null;
}): boolean {
  return input.threadKind === "side" && input.sourceContextKind === "quality_event";
}

const MANAGER_QUALITY_CSS = String.raw`
.mq-card{border-color:#c7d2fe;background:linear-gradient(180deg,#fff,#f8faff)}
.mq-head,.mq-row-head,.mq-actions{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap}
.mq-head h2,.mq-row h3{margin:0}.mq-list{display:grid;gap:10px;margin-top:14px}.mq-row{border:1px solid #dbeafe;border-radius:12px;padding:13px;background:#fff}
.mq-meta,.mq-summary{font-size:13px;color:#64748b;margin:5px 0 0;overflow-wrap:anywhere}.mq-summary{color:#334155;white-space:pre-wrap}
.mq-badge{display:inline-flex;border-radius:999px;padding:3px 9px;background:#eef2ff;color:#3730a3;font-size:12px;font-weight:700}
.mq-dialog{width:min(620px,calc(100vw - 28px));border:0;border-radius:14px;padding:20px}.mq-dialog::backdrop{background:rgba(15,23,42,.45)}
.mq-contact-list{display:grid;gap:6px;max-height:180px;overflow:auto}.mq-contact-option{display:flex;justify-content:space-between;gap:8px;text-align:left;border:1px solid #e2e8f0;background:#fff;border-radius:8px;padding:9px;cursor:pointer}
.mq-review-list,.mq-package-list{display:grid;gap:8px;margin-top:10px}.mq-review-item,.mq-package-item{border:1px solid #e2e8f0;border-radius:10px;padding:10px;background:#f8fafc}.mq-review-item h4,.mq-package-item h4{margin:0 0 5px}.mq-file-link{display:block;font-size:12px;margin-top:4px}
@media(max-width:640px){.mq-actions .btn{width:100%}.mq-dialog{width:100vw;max-width:none;height:100dvh;border-radius:0}}
`;

function buildManagerQualityClientJs(): string {
  return String.raw`(function () {
  var mount = document.getElementById('managerQualityList');
  if (!mount) return;
  var dialog = document.getElementById('managerQualityDelegateDialog');
  var evidenceDialog = document.getElementById('managerQualityEvidenceDialog');
  var packageDialog = document.getElementById('managerQualityPackageDialog');
  var current = null;
  var evidenceCurrent = null;
  function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = String(text); return n; }
  function uuid() { return crypto.randomUUID(); }
  function statusText(value) { return ({PENDING_ACCEPTANCE:'待我承接',IN_PROGRESS:'处理中',PENDING_PARENT_REVIEW:'待上级验收',APPROVED:'已通过',RETURNED:'已退回'})[value] || value; }
  async function qualityApi(path, options) { var r = await fetch(path, options || {}); var p = await r.json().catch(function(){return {};}); if (!r.ok || !p.ok) throw new Error(p.error || ('请求失败（'+r.status+'）')); return p.data || {}; }
  function post(path, body) { return qualityApi(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}); }
  async function action(node, kind) {
    if (kind === 'reject') { var reason = window.prompt('请输入驳回原因'); if (!reason) return; await post('/api/workbench/manager/quality-nodes/'+encodeURIComponent(node.nodeId)+'/reject',{expectedVersion:node.version,requestId:uuid(),reason:reason}); }
    else await post('/api/workbench/manager/quality-nodes/'+encodeURIComponent(node.nodeId)+'/accept',{expectedVersion:node.version,requestId:uuid()});
    await load();
  }
  function card(node) {
    var row=el('article','mq-row'); var head=el('div','mq-row-head'); var title=el('div'); title.append(el('h3','',node.eventNo+' · '+node.eventTitle),el('div','mq-meta','质量任务 · 节点期限：'+new Date(node.dueAt).toLocaleString('zh-CN',{hour12:false}))); head.append(title,el('span','mq-badge',statusText(node.status))); row.append(head,el('p','mq-summary',node.eventSummary),el('p','mq-meta','来源质量专员：'+(node.specialistUserId||'暂无')+' · 原主责：'+(node.primaryAssigneeUserId||'待首次承接确定')+' · 直接上级：'+(node.parentAssigneeUserId||node.specialistUserId||'暂无')),el('p','mq-meta','节点要求：'+node.requirement));
    if(node.reviewChildren&&node.reviewChildren.length){var reviewList=el('section','mq-review-list');reviewList.appendChild(el('h4','','待我验收的下级证据'));node.reviewChildren.forEach(function(child){var item=el('div','mq-review-item');item.append(el('h4','',child.assigneeUserId+' · '+child.departmentName),el('p','mq-meta','要求：'+child.requirement));(child.evidence||[]).forEach(function(file){var a=el('a','mq-file-link','第 '+file.evidenceVersion+' 版 · '+file.originalName+' · '+file.summary);a.href='/api/workbench/quality/evidence/'+encodeURIComponent(file.evidenceId);item.appendChild(a);});var ra=el('div','mq-actions');var ok=el('button','btn btn-primary btn-sm','通过');ok.type='button';ok.addEventListener('click',function(){void post('/api/workbench/quality/nodes/'+encodeURIComponent(child.nodeId)+'/review',{decision:'APPROVE',expectedVersion:child.version,requestId:uuid()}).then(load).catch(showError);});var back=el('button','btn btn-secondary btn-sm','退回');back.type='button';back.addEventListener('click',function(){var reason=window.prompt('请填写退回原因');if(!reason)return;void post('/api/workbench/quality/nodes/'+encodeURIComponent(child.nodeId)+'/review',{decision:'RETURN',reason:reason,expectedVersion:child.version,requestId:uuid()}).then(load).catch(showError);});ra.append(ok,back);item.appendChild(ra);reviewList.appendChild(item);});row.appendChild(reviewList);}
    var actions=el('div','mq-actions');
    if(node.status==='PENDING_ACCEPTANCE'){var accept=el('button','btn btn-primary btn-sm','承接');accept.type='button';accept.addEventListener('click',function(){void action(node,'accept').catch(showError);});var reject=el('button','btn btn-secondary btn-sm','驳回');reject.type='button';reject.addEventListener('click',function(){void action(node,'reject').catch(showError);});actions.append(accept,reject);}
    if(node.status==='IN_PROGRESS'&&node.assigneeKind==='MANAGER'){var delegate=el('button','btn btn-secondary btn-sm','分配给下属或其他部门主管');delegate.type='button';delegate.addEventListener('click',function(){current=node;document.getElementById('mqDelegateForm').reset();document.getElementById('mqTargetUserId').value='';document.getElementById('mqContactOptions').replaceChildren();dialog.showModal();});var evidence=el('button','btn btn-primary btn-sm','证据与完成');evidence.type='button';evidence.addEventListener('click',function(){evidenceCurrent=node;document.getElementById('mqEvidenceForm').reset();document.getElementById('mqEvidenceFeedback').textContent='';evidenceDialog.showModal();});actions.append(delegate,evidence);}
    if(node.isPrimary&&node.eventStatus==='PENDING_PRIMARY_REVIEW'){var overall=el('button','btn btn-primary btn-sm','查看全链路证据并整体验收');overall.type='button';overall.addEventListener('click',function(){void openPackage(node).catch(showError);});actions.appendChild(overall);}
    if(actions.childNodes.length)row.append(actions);return row;
  }
  function showError(error){var fb=document.getElementById('managerQualityFeedback');if(fb)fb.textContent=error&&error.message?error.message:String(error);}
  async function load(){var data=await qualityApi('/api/workbench/manager/quality-nodes');mount.replaceChildren();if(!data.nodes.length){document.getElementById('managerQualitySection').hidden=true;return;}data.nodes.forEach(function(node){mount.appendChild(card(node));});}
  var search=document.getElementById('mqContactSearch'); if(search)search.addEventListener('input',function(){var q=search.value.trim();if(q.length<1)return;void fetch('/api/workbench/manager/contacts?keyword='+encodeURIComponent(q)).then(function(r){return r.json();}).then(function(data){var box=document.getElementById('mqContactOptions');box.replaceChildren();(data.contacts||[]).filter(function(c){return c.active;}).forEach(function(c){var b=el('button','mq-contact-option',c.name+' · '+c.departmentSummary);b.type='button';b.addEventListener('click',function(){document.getElementById('mqTargetUserId').value=c.userId;document.getElementById('mqDepartment').value=c.departmentName;search.value=c.name;box.replaceChildren();});box.appendChild(b);});}).catch(showError);});
  document.getElementById('mqDelegateCancel').addEventListener('click',function(){dialog.close();});
  document.getElementById('mqDelegateForm').addEventListener('submit',function(event){event.preventDefault();if(!current)return;var body={assigneeUserId:document.getElementById('mqTargetUserId').value,assigneeKind:document.getElementById('mqTargetKind').value,departmentName:document.getElementById('mqDepartment').value,dueAt:document.getElementById('mqDueAt').value,requirement:document.getElementById('mqRequirement').value,expectedVersion:current.version,requestId:uuid()};void post('/api/workbench/manager/quality-nodes/'+encodeURIComponent(current.nodeId)+'/delegate',body).then(function(){dialog.close();return load();}).catch(showError);});
  document.getElementById('mqEvidenceCancel').addEventListener('click',function(){evidenceDialog.close();});
  document.getElementById('mqEvidenceForm').addEventListener('submit',function(event){event.preventDefault();if(!evidenceCurrent)return;var file=document.getElementById('mqEvidenceFile').files[0];var summary=document.getElementById('mqEvidenceSummary').value.trim();if(!file||!summary)return;var form=new FormData();form.append('requestId',uuid());form.append('summary',summary);form.append('file',file);var fb=document.getElementById('mqEvidenceFeedback');fb.textContent='上传中…';void fetch('/api/workbench/quality/nodes/'+encodeURIComponent(evidenceCurrent.nodeId)+'/evidence',{method:'POST',body:form}).then(function(r){return r.json().then(function(p){if(!r.ok||!p.ok)throw new Error(p.error||('请求失败（'+r.status+'）'));return p;});}).then(function(){document.getElementById('mqEvidenceForm').reset();fb.textContent='证据已上传，可继续上传或提交完成';}).catch(showError);});
  document.getElementById('mqSubmitCompletion').addEventListener('click',function(){if(!evidenceCurrent)return;void post('/api/workbench/quality/nodes/'+encodeURIComponent(evidenceCurrent.nodeId)+'/submit-completion',{expectedVersion:evidenceCurrent.version,requestId:uuid()}).then(function(){evidenceDialog.close();return load();}).catch(showError);});
  async function openPackage(node){var data=await qualityApi('/api/workbench/quality/events/'+encodeURIComponent(node.eventId)+'/evidence-package');var mount=document.getElementById('mqPackageList');mount.replaceChildren();data.nodes.forEach(function(item){var box=el('div','mq-package-item');box.append(el('h4','',Array(item.depth+1).join('└ ') + item.assigneeUserId+' · '+item.departmentName),el('p','mq-meta','状态：'+statusText(item.status)+' · 期限：'+new Date(item.dueAt).toLocaleString('zh-CN',{hour12:false})));(item.evidence||[]).forEach(function(file){var a=el('a','mq-file-link','第 '+file.evidenceVersion+' 版 · '+file.originalName+' · '+file.summary);a.href='/api/workbench/quality/evidence/'+encodeURIComponent(file.evidenceId);box.appendChild(a);});if(!item.isPrimary){var back=el('button','btn btn-secondary btn-sm','退回此分支');back.type='button';back.addEventListener('click',function(){var reason=window.prompt('请填写退回原因');if(!reason)return;void post('/api/workbench/quality/events/'+encodeURIComponent(node.eventId)+'/primary-review',{decision:'RETURN_NODE',returnedNodeId:item.nodeId,reason:reason,expectedVersion:data.event.version,requestId:uuid()}).then(function(){packageDialog.close();return load();}).catch(showError);});box.appendChild(back);}mount.appendChild(box);});document.getElementById('mqPackageApprove').onclick=function(){void post('/api/workbench/quality/events/'+encodeURIComponent(node.eventId)+'/primary-review',{decision:'APPROVE',expectedVersion:data.event.version,requestId:uuid()}).then(function(){packageDialog.close();return load();}).catch(showError);};packageDialog.showModal();}
  document.getElementById('mqPackageClose').addEventListener('click',function(){packageDialog.close();});
  void load().catch(showError);
})();`;
}

function escapeHtml(v: string): string {
  return v
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function badgeClass(status: string): string {
  if (status === "BLOCKED") return "blocked";
  if (status === "ASSIGNED" || status === "CHANGES_REQUESTED") return status === "CHANGES_REQUESTED" ? "pending" : "assigned";
  if (status === "IN_PROGRESS") return "progress";
  if (status === "DONE") return "done";
  if (status === "REJECTED") return "rejected";
  return "assigned";
}

function workbenchEnforceActionGuards(): boolean {
  const raw = String(process.env.WORKBENCH_ENFORCE_ACTION_GUARDS ?? "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

export function renderManagerTasksPage(params: {
  planId?: string;
  planTitle?: string;
  userLabel?: string;
  sessionUserId?: string;
  projectPortfolioEnabled?: boolean;
  initialProjectId?: string;
  initialView?: "group" | "flat";
  showAdminOpsLink?: boolean;
}): string {
  const who = params.userLabel ? escapeHtml(params.userLabel) : "主管";
  const hasQualityTasks = Boolean(params.sessionUserId && hasQualityAssignmentNodesForUser(params.sessionUserId));
  const portfolio = Boolean(params.projectPortfolioEnabled);
  const initialProjectId = escapeHtml(params.initialProjectId ?? "");
  const initialView = params.initialView === "flat" ? "flat" : "group";
  const projectFilter = portfolio
    ? `<label id="filterProjectWrap">所属项目
          <select id="filterProject">
            <option value="">全部项目</option>
            <option value="__unassigned__">仅未归入项目</option>
          </select>
        </label>`
    : "";
  const portfolioFilterFooter = portfolio
    ? `<div class="wb-filter-footer">
        <span class="wb-filter-footer-lbl">视图</span>
        <div class="wb-tasks-view-mode" role="group" aria-label="列表视图">
          <button type="button" data-wb-view-mode="flat" aria-pressed="false">平铺列表</button>
          <button type="button" data-wb-view-mode="group" aria-pressed="true">按项目归档</button>
        </div>
        <span class="wb-filter-hint">归档视图下，「所属项目」用于限定显示的项目组</span>
      </div>`
    : "";
  const portfolioExtras = portfolio
    ? `<div class="wb-bulk-bar" id="bulkAssignBar" role="status" aria-live="polite">
        <div class="wb-bulk-bar__left">
          <span class="wb-bulk-bar__badge" id="bulkAssignCount">0</span>
          <span class="wb-bulk-bar__title">条任务已选 · 可批量归入项目</span>
        </div>
        <div class="wb-bulk-bar__actions">
          <button type="button" class="btn btn-primary btn-sm" id="bulkAssignBtn">归入项目…</button>
          <button type="button" class="btn btn-ghost btn-sm" id="bulkAssignClearBtn">取消选择</button>
        </div>
      </div>`
    : "";

  return renderWorkbenchPage({
    role: "manager",
    activeNav: "mgr-tasks",
    title: "历史任务管理",
    pageTitle: "历史任务 · 主管工作台",
    description: "查看已发布任务的进度与负责人，必要时调整分配方案。列表优先突出阻塞与待处理事项。",
    userLabel: params.userLabel,
    sessionUserId: params.sessionUserId,
    portfolioEnabled: portfolio,
    showAdminOpsLink: params.showAdminOpsLink,
    extraCss: (portfolio ? WORKBENCH_TASKS_PORTFOLIO_CSS + WORKBENCH_TASKS_FILTER_UNIFIED_CSS : "") + (hasQualityTasks ? MANAGER_QUALITY_CSS : ""),
    mainHtml: `
  ${hasQualityTasks ? `<section class="card mq-card" id="managerQualitySection"><div class="mq-head"><div><h2>质量任务 · 待我承接</h2><p class="muted">质量任务在本页承接、驳回和继续分配，不需要进入独立质量页。</p></div><span class="mq-badge">质量任务</span></div><div class="mq-list" id="managerQualityList"><div class="empty-state">正在加载…</div></div><div class="feedback err" id="managerQualityFeedback"></div></section>
  <dialog class="mq-dialog" id="managerQualityDelegateDialog"><form class="form-stack" id="mqDelegateForm"><h2>分配质量任务</h2><label>搜索承接人<input id="mqContactSearch" type="search" autocomplete="off"><input id="mqTargetUserId" type="hidden"><div class="mq-contact-list" id="mqContactOptions"></div></label><label>承接人类型<select id="mqTargetKind"><option value="EMPLOYEE">本部门或其他部门员工</option><option value="MANAGER">其他部门主管</option></select></label><label>部门<input id="mqDepartment" required></label><label>子节点期限<input id="mqDueAt" type="datetime-local" required></label><label>处理要求<textarea id="mqRequirement" required maxlength="5000"></textarea></label><div class="mq-actions"><button class="btn btn-secondary" type="button" id="mqDelegateCancel">取消</button><button class="btn btn-primary" type="submit">确认分配</button></div></form></dialog>
  <dialog class="mq-dialog" id="managerQualityEvidenceDialog"><form class="form-stack" id="mqEvidenceForm"><h2>质量证据与完成</h2><label>证据摘要<textarea id="mqEvidenceSummary" required maxlength="2000"></textarea></label><label>证据文件（单个不超过 20 MB）<input id="mqEvidenceFile" type="file" required></label><button class="btn btn-secondary" type="submit">上传证据</button><p class="muted">已向下分配时，待所有直接子节点通过后直接提交汇总，无需重复上传下级证据。</p><div class="feedback" id="mqEvidenceFeedback"></div><div class="mq-actions"><button class="btn btn-secondary" type="button" id="mqEvidenceCancel">关闭</button><button class="btn btn-primary" type="button" id="mqSubmitCompletion">提交完成并送上级验收</button></div></form></dialog>
  <dialog class="mq-dialog" id="managerQualityPackageDialog"><h2>全链路证据包</h2><p class="muted">按分配层级展示责任人、期限、每版证据与验收历史。</p><div class="mq-package-list" id="mqPackageList"></div><div class="mq-actions"><button class="btn btn-secondary" type="button" id="mqPackageClose">关闭</button><button class="btn btn-primary" type="button" id="mqPackageApprove">整体通过并送质量专员</button></div></dialog>` : ""}
  <div class="card mgr-tasks-card">
    <div class="tabs" role="tablist" aria-label="任务操作">
      <button type="button" class="tabs-btn" role="tab" aria-selected="true" aria-controls="mgrPanelList" id="mgrTabList" data-tab-target="mgrPanelList">任务列表</button>
      <button type="button" class="tabs-btn" role="tab" aria-selected="false" aria-controls="mgrPanelReassign" id="mgrTabReassign" data-tab-target="mgrPanelReassign">调整分配</button>
    </div>

    <section class="tab-panel panel-stack" id="mgrPanelList" role="tabpanel" aria-labelledby="mgrTabList">
      <section class="kpis kpis--3" aria-live="polite">
        <div class="kpi"><div class="lbl">待您处理</div><div class="val" id="kpiNeedsMgr">—</div></div>
        <div class="kpi"><div class="lbl">员工执行中</div><div class="val" id="kpiRunning">—</div></div>
        <div class="kpi"><div class="lbl">待员工承接</div><div class="val" id="kpiWaiting">—</div></div>
      </section>
      <div class="mgr-filter-seg-wrap">
      <div class="mgr-filter-seg" role="group" aria-label="快速筛选">
        <button type="button" data-attention="">全部</button>
        <button type="button" data-attention="needs_manager" class="is-on">待您处理</button>
        <button type="button" data-attention="waiting_employee">待承接</button>
        <button type="button" data-attention="employee_running">执行中</button>
        <button type="button" data-attention="blocked">阻塞</button>
      </div>
      </div>
      <details class="mgr-filter-advanced">
        <summary>高级筛选</summary>
        <div class="mgr-list-toolbar${portfolio ? " mgr-list-toolbar--portfolio" : " form-stack"}" role="search" aria-label="任务筛选" style="margin-top:10px;">
        <label>关注状态
          <select id="filterAttention">
            <option value="">全部</option>
            <option value="needs_manager" selected>待您处理</option>
            <option value="waiting_employee">待员工承接</option>
            <option value="employee_running">员工执行中</option>
            <option value="blocked">阻塞</option>
            <option value="done">已完成</option>
          </select>
        </label>
        ${projectFilter}
        <label>标题 / 业务编号
          <input id="filterKeyword" type="search" placeholder="关键词" autocomplete="off" />
        </label>
        <label>负责人
          <input id="filterAssignee" type="search" placeholder="姓名" autocomplete="off" />
        </label>
        <label>排序
          <select id="filterSort">
            <option value="updated_desc">更新时间 ↓</option>
            <option value="updated_asc">更新时间 ↑</option>
            <option value="task_no">业务编号</option>
            <option value="attention">关注优先级</option>
          </select>
        </label>
        <div class="${portfolio ? "wb-filter-actions" : ""}" style="${portfolio ? "" : "display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end;"}">
          <button type="button" class="btn btn-primary btn-sm" id="filterApplyBtn">应用筛选</button>
          <button type="button" class="btn btn-ghost btn-sm" id="filterClearBtn">清除</button>
        </div>
        ${portfolioFilterFooter}
        </div>
      </details>
      ${portfolioExtras}
      <p class="muted" id="filterResultMeta" style="margin:0 0 10px;font-size:13px;" role="status" aria-live="polite">—</p>
      <div>
        <p class="page-desc" style="margin:0 0 14px;">${who}可见的全部任务；列表状态为「需您关注」视角，与子任务实际状态可能不同。</p>
        <div id="taskTableMount">
          <div class="empty-state">加载中…</div>
        </div>
        <div class="feedback muted" id="tableFeedback"></div>
      </div>
    </section>

    <section class="tab-panel" id="mgrPanelReassign" role="tabpanel" aria-labelledby="mgrTabReassign" hidden>
      <h2>调整分配</h2>
      <p class="page-desc" style="margin:0 0 14px;">选择任务并指定新负责人（按<strong>姓名</strong>查找），保存后立即生效。</p>
      <div class="form-stack">
        <label>任务
          <div class="reassign-task-picker" id="reassignTaskPickerWrap">
            <button type="button" class="reassign-task-picker__btn" id="reassignPlanBtn" aria-haspopup="listbox" aria-expanded="false">
              <span class="reassign-task-picker__text" id="reassignPlanLabel">请选择任务</span>
              <span class="reassign-task-picker__chev" aria-hidden="true">▾</span>
            </button>
            <input type="hidden" id="reassignPlanId" value="" />
            <input type="hidden" id="reassignPlanTaskNo" value="" />
            <ul class="reassign-task-picker__list" id="reassignPlanOptions" role="listbox" hidden></ul>
          </div>
        </label>
        <label>新负责人（输入姓名或部门，弹出候选）
          <div class="combo" style="position:relative;">
            <input id="reassignAssigneeInput" type="search" autocomplete="off" placeholder="输入姓名或部门（1 字起搜）" style="width:100%;" />
            <input id="reassignAssigneeUserId" type="hidden" value="" />
            <ul id="reassignAssigneeOptions" class="combo-options" hidden></ul>
          </div>
        </label>
        <label>改派范围（可选）
          <div class="reassign-task-picker reassign-subtask-picker" id="reassignSubtaskPickerWrap">
            <button type="button" class="reassign-task-picker__btn" id="reassignSubtaskBtn" aria-haspopup="listbox" aria-expanded="false" disabled>
              <span class="reassign-task-picker__text" id="reassignSubtaskLabel">全部子任务（未完成）</span>
              <span class="reassign-task-picker__chev" aria-hidden="true">▾</span>
            </button>
            <input type="hidden" id="reassignSubtaskPick" value="" />
            <ul class="reassign-task-picker__list" id="reassignSubtaskOptions" role="listbox" hidden></ul>
          </div>
        </label>
        <label>说明
          <textarea id="reassignNote" placeholder="简要说明改派原因"></textarea>
        </label>
        <div class="wb-confirm-bar" id="mgrReassignConfirmWrap" hidden>
          <div class="wb-confirm-bar__row">
            <input type="checkbox" id="mgrReassignConfirm" />
            <label for="mgrReassignConfirm">确认执行改派</label>
          </div>
        </div>
        <div>
          <button type="button" class="btn btn-primary" id="reassignBtn">保存改派</button>
        </div>
        <div class="feedback muted" id="reassignFeedback"></div>
      </div>
    </section>
  </div>
${portfolio ? `<dialog id="assignProjectDialog">
  <form method="dialog" class="form-stack" style="min-width:360px;padding:8px;" onsubmit="return false;">
    <h2 id="assignProjectDialogTitle" style="margin:0 0 12px;">归入项目</h2>
    <p class="muted" id="assignProjectTaskLine" style="margin:0 0 12px;">—</p>
    <label>选择项目
      <select id="assignProjectSelect"></select>
    </label>
    <p class="feedback muted" id="assignProjectFeedback"></p>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px;">
      <button type="button" class="btn btn-ghost" id="assignProjectCancelBtn">取消</button>
      <button type="button" class="btn btn-primary" id="assignProjectSaveBtn">保存</button>
    </div>
  </form>
</dialog>` : ""}`,
    scriptHtml: `<script>
(function () {
  ${buildWorkbenchViewSwitchClientJs()}
  ${buildWorkbenchContactComboClientJs()}
  wbBindViewSwitchLink('navMyTasks', 'employee', '/workbench/employee?view=new');
  var WB_ENFORCE_ACTION_GUARDS = ${workbenchEnforceActionGuards() ? "true" : "false"};
  var WB_PORTFOLIO = ${portfolio ? "true" : "false"};
  var WB_FILTER_PROJECT_ID = '';
  if (WB_ENFORCE_ACTION_GUARDS) {
    var mgrWrap = document.getElementById('mgrReassignConfirmWrap');
    if (mgrWrap) mgrWrap.removeAttribute('hidden');
  }
  function setText(id, t) {
    var el = document.getElementById(id);
    if (el) el.textContent = t;
  }
  function setFb(id, msg, kind) {
    var el = document.getElementById(id);
    if (!el) return;
    el.textContent = msg || '';
    el.className = 'feedback ' + (kind || 'muted');
  }
  function setActiveTab(targetId) {
    document.querySelectorAll('.tabs-btn[data-tab-target]').forEach(function (btn) {
      var active = btn.getAttribute('data-tab-target') === targetId;
      btn.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    document.querySelectorAll('.tab-panel[id^="mgrPanel"]').forEach(function (panel) {
      panel.hidden = panel.id !== targetId;
    });
  }
  document.querySelectorAll('.tabs-btn[data-tab-target]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var tid = btn.getAttribute('data-tab-target') || 'mgrPanelList';
      setActiveTab(tid);
    });
  });
  ${buildWorkbenchFmtTimeClientJs()}
  function attentionRank(bucket) {
    if (bucket === 'needs_manager') return 0;
    if (bucket === 'blocked') return 1;
    if (bucket === 'waiting_employee') return 2;
    if (bucket === 'employee_running') return 3;
    return 4;
  }
  function badgeClassForBucket(bucket) {
    if (bucket === 'needs_manager') return 'pending';
    if (bucket === 'blocked') return 'blocked';
    if (bucket === 'waiting_employee') return 'assigned';
    if (bucket === 'employee_running') return 'progress';
    if (bucket === 'done') return 'done';
    return 'assigned';
  }
  var allTasksCache = [];
  function wbReadInputValue(id) {
    var el = document.getElementById(id);
    return el ? String(el.value || '').trim() : '';
  }
  function wbSetInputValue(id, value) {
    var el = document.getElementById(id);
    if (el) el.value = value || '';
  }
  function wbRestoreListStateFromUrl() {
    try {
      var usp = new URLSearchParams(window.location.search || '');
      if (usp.has('attention')) wbSetInputValue('filterAttention', String(usp.get('attention') || ''));
      if (usp.has('keyword')) wbSetInputValue('filterKeyword', String(usp.get('keyword') || ''));
      if (usp.has('assignee')) wbSetInputValue('filterAssignee', String(usp.get('assignee') || ''));
      if (usp.has('sort')) wbSetInputValue('filterSort', String(usp.get('sort') || 'updated_desc'));
      syncMgrFilterSeg(wbReadInputValue('filterAttention') || '');
    } catch (e0) {}
  }
  function wbAppendListStateParams(usp) {
    usp.set('attention', wbReadInputValue('filterAttention'));
    var kw = wbReadInputValue('filterKeyword');
    var asg = wbReadInputValue('filterAssignee');
    var sort = wbReadInputValue('filterSort') || 'updated_desc';
    if (kw) usp.set('keyword', kw); else usp.delete('keyword');
    if (asg) usp.set('assignee', asg); else usp.delete('assignee');
    if (sort && sort !== 'updated_desc') usp.set('sort', sort); else usp.delete('sort');
    try {
      if (typeof WB_VIEW_MODE !== 'undefined' && WB_VIEW_MODE) usp.set('view', WB_VIEW_MODE);
      if (typeof WB_SCOPE !== 'undefined' && WB_SCOPE && WB_SCOPE !== 'all') usp.set('scope', WB_SCOPE);
      else usp.delete('scope');
      if (typeof WB_FILTER_PROJECT_ID !== 'undefined' && WB_FILTER_PROJECT_ID) usp.set('projectId', WB_FILTER_PROJECT_ID);
      else if (!(typeof WB_SCOPE !== 'undefined' && WB_SCOPE && WB_SCOPE !== 'all')) usp.delete('projectId');
      if (typeof WB_EXPAND_PROJECT_ID !== 'undefined' && WB_EXPAND_PROJECT_ID) usp.set('expandedProjectId', WB_EXPAND_PROJECT_ID);
      else usp.delete('expandedProjectId');
    } catch (e1) {}
    usp.delete('planId');
    usp.delete('focus');
    usp.delete('subtaskId');
    return usp;
  }
  function wbCurrentTasksBackPath() {
    var usp = wbAppendListStateParams(new URLSearchParams());
    var qs = usp.toString();
    return '/workbench/manager/tasks' + (qs ? '?' + qs : '');
  }
  function wbPersistListStateToUrl() {
    try {
      if (!window.history || !window.history.replaceState) return;
      var usp = wbAppendListStateParams(new URLSearchParams(window.location.search || ''));
      var qs = usp.toString();
      window.history.replaceState(null, '', window.location.pathname + (qs ? '?' + qs : ''));
    } catch (e2) {}
  }
  function wbBuildTaskDetailHref(taskNo) {
    return '/workbench/manager/task?taskNo=' +
      encodeURIComponent(taskNo || '') +
      '&returnTo=' +
      encodeURIComponent(wbCurrentTasksBackPath());
  }
  function wbRenderActionsCell(t) {
    return '<td>' + fmtTime(t.updatedAt) + '<br><a href="' +
      wbBuildTaskDetailHref(t.taskNo || '') +
      '">鏌ョ湅璇︽儏</a></td>';
  }
  function escapeHtml(s) {
    return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
  function truncateLabel(s, max) {
    s = String(s || '').trim();
    if (s.length <= max) return s;
    return s.slice(0, Math.max(0, max - 1)) + '…';
  }
  function wbReassignTaskShortLabel(t) {
    var no = String(t.taskNo || '任务');
    var title = truncateLabel(String(t.title || ''), 22);
    var st = String(t.statusLabel || t.status || '');
    return no + ' · ' + title + (st ? ' · ' + st : '');
  }
  function wbCloseReassignPlanPicker() {
    var list = document.getElementById('reassignPlanOptions');
    var btn = document.getElementById('reassignPlanBtn');
    var backdrop = document.getElementById('reassignPlanBackdrop');
    if (list) list.hidden = true;
    if (btn) btn.setAttribute('aria-expanded', 'false');
    if (backdrop) backdrop.hidden = true;
  }
  function wbEnsureReassignPlanBackdrop() {
    if (document.getElementById('reassignPlanBackdrop')) return;
    var backdrop = document.createElement('div');
    backdrop.id = 'reassignPlanBackdrop';
    backdrop.className = 'reassign-picker-backdrop';
    backdrop.hidden = true;
    backdrop.addEventListener('click', wbCloseReassignPlanPicker);
    document.body.appendChild(backdrop);
  }
  function wbOpenReassignPlanPicker() {
    var list = document.getElementById('reassignPlanOptions');
    var btn = document.getElementById('reassignPlanBtn');
    if (!list || !btn || btn.disabled) return;
    wbEnsureReassignPlanBackdrop();
    var backdrop = document.getElementById('reassignPlanBackdrop');
    list.hidden = false;
    btn.setAttribute('aria-expanded', 'true');
    if (backdrop && window.innerWidth <= 720) backdrop.hidden = false;
  }
  function wbSetReassignPlanPicker(planId, taskNo, label) {
    var hid = document.getElementById('reassignPlanId');
    var hidNo = document.getElementById('reassignPlanTaskNo');
    var lbl = document.getElementById('reassignPlanLabel');
    if (hid) hid.value = planId || '';
    if (hidNo) hidNo.value = taskNo || '';
    if (lbl) lbl.textContent = label || '请选择任务';
    wbCloseReassignPlanPicker();
  }
  function wbReassignEligibleTasks(tasks) {
    return (tasks || []).filter(function (t) {
      var bucket = String(t.attentionBucket || '');
      var st = String(t.status || '').toUpperCase();
      return bucket !== 'stopped' && st !== 'STOPPED';
    });
  }
  window.wbReassignEligibleTasks = wbReassignEligibleTasks;
  function wbPopulateReassignPlanPicker(tasks) {
    var list = document.getElementById('reassignPlanOptions');
    var btn = document.getElementById('reassignPlanBtn');
    if (!list || !btn) return;
    if (!tasks || !tasks.length) {
      list.innerHTML = '';
      wbSetReassignPlanPicker('', '', '暂无任务');
      btn.disabled = true;
      return;
    }
    btn.disabled = false;
    list.innerHTML = tasks.map(function (t) {
      var planId = escapeHtml(t.planId);
      var taskNo = escapeHtml(t.taskNo || '');
      var title = escapeHtml(String(t.title || '').trim() || '（无标题）');
      var st = escapeHtml(String(t.statusLabel || t.status || ''));
      var full = escapeHtml(wbReassignTaskShortLabel(t));
      return '<li role="option" tabindex="0" data-plan-id="' + planId + '" data-task-no="' + taskNo + '" data-label="' + full + '">'
        + '<span class="reassign-task-picker__opt-no">' + escapeHtml(t.taskNo || '—') + '</span>'
        + '<span class="reassign-task-picker__opt-main"><span class="reassign-task-picker__opt-title">' + title + '</span>'
        + (st ? '<span class="reassign-task-picker__opt-st">' + st + '</span>' : '') + '</span></li>';
    }).join('');
    if (!btn.dataset.boundReassignPicker) {
      btn.dataset.boundReassignPicker = '1';
      btn.addEventListener('click', function () {
        if (btn.disabled) return;
        var open = list.hidden;
        if (open) wbOpenReassignPlanPicker();
        else wbCloseReassignPlanPicker();
      });
      list.addEventListener('click', function (e) {
        var li = e.target.closest('[data-plan-id]');
        if (!li) return;
        wbSetReassignPlanPicker(li.getAttribute('data-plan-id'), li.getAttribute('data-task-no'), li.getAttribute('data-label'));
        void loadSubtasksForReassign();
      });
      list.addEventListener('keydown', function (e) {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        var li = e.target.closest('[data-plan-id]');
        if (!li) return;
        e.preventDefault();
        wbSetReassignPlanPicker(li.getAttribute('data-plan-id'), li.getAttribute('data-task-no'), li.getAttribute('data-label'));
        void loadSubtasksForReassign();
      });
      document.addEventListener('click', function (e) {
        var wrap = document.getElementById('reassignTaskPickerWrap');
        if (wrap && !wrap.contains(e.target)) wbCloseReassignPlanPicker();
      });
    }
  }
  window.wbPopulateReassignPlanPicker = wbPopulateReassignPlanPicker;
  window.wbSetReassignPlanPicker = wbSetReassignPlanPicker;

  function wbCloseReassignSubtaskPicker() {
    var list = document.getElementById('reassignSubtaskOptions');
    var btn = document.getElementById('reassignSubtaskBtn');
    var backdrop = document.getElementById('reassignSubtaskBackdrop');
    if (list) list.hidden = true;
    if (btn) btn.setAttribute('aria-expanded', 'false');
    if (backdrop) backdrop.hidden = true;
  }
  function wbSetReassignSubtaskPicker(subtaskId, label) {
    var hid = document.getElementById('reassignSubtaskPick');
    var lbl = document.getElementById('reassignSubtaskLabel');
    if (hid) hid.value = subtaskId || '';
    if (lbl) lbl.textContent = label || '全部子任务（未完成）';
    wbCloseReassignSubtaskPicker();
  }
  function wbEnsureReassignSubtaskBackdrop() {
    var wrap = document.getElementById('reassignSubtaskPickerWrap');
    if (!wrap || document.getElementById('reassignSubtaskBackdrop')) return;
    var backdrop = document.createElement('div');
    backdrop.id = 'reassignSubtaskBackdrop';
    backdrop.className = 'reassign-picker-backdrop';
    backdrop.hidden = true;
    backdrop.addEventListener('click', wbCloseReassignSubtaskPicker);
    document.body.appendChild(backdrop);
  }
  function wbOpenReassignSubtaskPicker() {
    var list = document.getElementById('reassignSubtaskOptions');
    var btn = document.getElementById('reassignSubtaskBtn');
    if (!list || !btn || btn.disabled) return;
    wbEnsureReassignSubtaskBackdrop();
    var backdrop = document.getElementById('reassignSubtaskBackdrop');
    list.hidden = false;
    btn.setAttribute('aria-expanded', 'true');
    if (backdrop && window.innerWidth <= 720) backdrop.hidden = false;
  }
  async function loadSubtasksForReassign() {
    var hidNo = document.getElementById('reassignPlanTaskNo');
    var list = document.getElementById('reassignSubtaskOptions');
    var btn = document.getElementById('reassignSubtaskBtn');
    if (!list || !btn) return;
    var taskNo = hidNo ? String(hidNo.value || '').trim() : '';
    list.innerHTML = '';
    wbSetReassignSubtaskPicker('', '全部子任务（未完成）');
    if (!taskNo) {
      btn.disabled = true;
      setFb('reassignFeedback', '', 'muted');
      return;
    }
    btn.disabled = false;
    try {
      var res = await fetch('/api/workbench/tasks/detail?taskNo=' + encodeURIComponent(taskNo));
      var data = await res.json().catch(function () { return {}; });
      if (!res.ok || !data.ok) {
        setFb('reassignFeedback', data.error ? String(data.error) : ('加载子任务失败 HTTP ' + res.status), 'err');
        return;
      }
      var rawSubs = data.subtasks || [];
      var subs = rawSubs.filter(function (s) {
        return String(s.status || '').toUpperCase() !== 'DONE';
      });
      var items = [{ id: '', label: '全部子任务（未完成）', title: '全部子任务（未完成）', meta: '' }];
      subs.forEach(function (s, idx) {
        var title = String(s.title || '').trim() || '（无标题）';
        var stLabel = String(s.statusLabel || s.status || '未知').trim();
        var who = String(s.assigneeDisplayName || s.assigneeUserId || '').trim() || '未指定';
        var line = (idx + 1) + '. ' + title;
        var meta = '【' + stLabel + '】 当前负责人：' + who;
        items.push({
          id: String(s.subtaskId || ''),
          label: truncateLabel(line + ' · ' + meta, 48),
          title: line,
          meta: meta
        });
      });
      list.innerHTML = items.map(function (it) {
        return '<li role="option" tabindex="0" data-subtask-id="' + escapeHtml(it.id) + '" data-label="' + escapeHtml(it.label) + '">'
          + '<span class="reassign-task-picker__opt-main"><span class="reassign-task-picker__opt-title">' + escapeHtml(it.title) + '</span>'
          + (it.meta ? '<span class="reassign-task-picker__opt-st">' + escapeHtml(it.meta) + '</span>' : '') + '</span></li>';
      }).join('');
      if (!btn.dataset.boundReassignSubPicker) {
        btn.dataset.boundReassignSubPicker = '1';
        btn.addEventListener('click', function () {
          if (btn.disabled) return;
          var open = list.hidden;
          if (open) wbOpenReassignSubtaskPicker();
          else wbCloseReassignSubtaskPicker();
        });
        list.addEventListener('click', function (e) {
          var li = e.target.closest('[data-subtask-id]');
          if (!li) return;
          wbSetReassignSubtaskPicker(li.getAttribute('data-subtask-id'), li.getAttribute('data-label'));
        });
        list.addEventListener('keydown', function (e) {
          if (e.key !== 'Enter' && e.key !== ' ') return;
          var li = e.target.closest('[data-subtask-id]');
          if (!li) return;
          e.preventDefault();
          wbSetReassignSubtaskPicker(li.getAttribute('data-subtask-id'), li.getAttribute('data-label'));
        });
        document.addEventListener('click', function (e) {
          var wrap = document.getElementById('reassignSubtaskPickerWrap');
          if (wrap && !wrap.contains(e.target)) wbCloseReassignSubtaskPicker();
        });
      }
      setFb('reassignFeedback', subs.length ? ('已加载 ' + subs.length + ' 条未完成子任务') : '该任务暂无未完成子任务', 'muted');
    } catch (e) {
      setFb('reassignFeedback', String(e && e.message ? e.message : e), 'err');
    }
  }

  wbAttachContactCombo({
    input: 'reassignAssigneeInput',
    hiddenUserId: 'reassignAssigneeUserId',
    optionsList: 'reassignAssigneeOptions',
    minLength: 1,
    searchUrl: function (kw) {
      return '/api/workbench/manager/contacts?keyword=' + encodeURIComponent(kw);
    },
    onFeedback: function (msg, kind) { setFb('reassignFeedback', msg, kind); }
  });

  function renderTaskTable(tasks) {
    var mount = document.getElementById('taskTableMount');
    var meta = document.getElementById('filterResultMeta');
    var total = allTasksCache.length;
    if (meta) meta.textContent = '共 ' + total + ' 条 · 当前显示 ' + tasks.length + ' 条';
    if (!tasks.length) {
      mount.innerHTML = '<div class="empty-state">' + (total ? '无匹配任务。<button type="button" class="btn btn-ghost btn-sm" id="filterClearInline">清除筛选</button>' : '暂无任务。请到钉钉与机器人发起规划并发布。') + '</div>';
      var clr = document.getElementById('filterClearInline');
      if (clr) clr.addEventListener('click', clearFilters);
      return;
    }
    var rows = tasks.map(function (t) {
      var bucket = String(t.attentionBucket || '');
      var hint = String(t.attentionHint || '').trim();
      var stHtml = '<span class="badge ' + badgeClassForBucket(bucket) + '">' + escapeHtml(t.attentionLabel || t.statusLabel || '—') + '</span>';
      if (hint) stHtml += ' <span class="muted" style="font-size:12px;">' + escapeHtml(hint) + '</span>';
      var actionsCell = (typeof wbRenderActionsCell === 'function')
        ? wbRenderActionsCell(t)
        : ('<td>' + fmtTime(t.updatedAt) + '<br><a href="/workbench/manager/task?taskNo='
          + encodeURIComponent(t.taskNo || '') + '">查看详情</a></td>');
      return '<tr>'
        + '<td><code>' + escapeHtml(t.taskNo || '—') + '</code></td>'
        + '<td>' + escapeHtml(t.title || '—') + '</td>'
        + '<td>' + escapeHtml(t.assigneeSummary || '—') + '</td>'
        + '<td>' + escapeHtml(String(t.subtasksCount || 0)) + '（阻塞 ' + escapeHtml(String(t.blockedCount || 0)) + '）</td>'
        + '<td>' + stHtml + '</td>'
        + actionsCell
        + '</tr>';
    }).join('');
    mount.innerHTML = '<div class="table-wrap"><table class="data">'
      + '<thead><tr><th>业务编号</th><th>标题</th><th>负责人</th><th>子任务</th><th>关注状态</th><th>更新时间</th></tr></thead>'
      + '<tbody>' + rows + '</tbody></table></div>';
  }
  function applyFiltersAndSort() {
    var att = String(document.getElementById('filterAttention')?.value || '').trim();
    var kw = String(document.getElementById('filterKeyword')?.value || '').trim().toLowerCase();
    var asg = String(document.getElementById('filterAssignee')?.value || '').trim().toLowerCase();
    var sort = String(document.getElementById('filterSort')?.value || 'updated_desc');
    var list = allTasksCache.slice();
    list = list.filter(function (t) {
      if (att && String(t.attentionBucket || '') !== att) return false;
      if (kw) {
        var hay = (String(t.taskNo || '') + ' ' + String(t.title || '')).toLowerCase();
        if (hay.indexOf(kw) < 0) return false;
      }
      if (asg) {
        var who = String(t.assigneeSummary || '').toLowerCase();
        if (who.indexOf(asg) < 0) return false;
      }
      return true;
    });
    list.sort(function (a, b) {
      if (sort === 'attention') {
        var pa = attentionRank(String(a.attentionBucket || ''));
        var pb = attentionRank(String(b.attentionBucket || ''));
        if (pa !== pb) return pa - pb;
      } else if (sort === 'task_no') {
        return String(a.taskNo || '').localeCompare(String(b.taskNo || ''), 'zh-CN');
      }
      var ta = Date.parse(a.updatedAt || '') || 0;
      var tb = Date.parse(b.updatedAt || '') || 0;
      return sort === 'updated_asc' ? ta - tb : tb - ta;
    });
    renderTaskTable(list);
  }
  function applyFiltersSortAndPersist() {
    applyFiltersAndSort();
    wbPersistListStateToUrl();
  }
  function syncMgrFilterSeg(att) {
    document.querySelectorAll('.mgr-filter-seg button[data-attention]').forEach(function (btn) {
      var v = String(btn.getAttribute('data-attention') || '');
      btn.classList.toggle('is-on', v === String(att || ''));
    });
  }
  function setFilterAttention(att) {
    var fa = document.getElementById('filterAttention');
    if (fa) fa.value = att || '';
    syncMgrFilterSeg(att || '');
    applyFiltersSortAndPersist();
  }
  function clearFilters() {
    var fk = document.getElementById('filterKeyword');
    var fas = document.getElementById('filterAssignee');
    var fs = document.getElementById('filterSort');
    if (fk) fk.value = '';
    if (fas) fas.value = '';
    if (fs) fs.value = 'updated_desc';
    setFilterAttention('needs_manager');
  }
  async function loadTasks() {
    setFb('tableFeedback', '加载中…', 'muted');
    try {
      var tasksUrl = '/api/workbench/manager/tasks';
      if (WB_PORTFOLIO && WB_FILTER_PROJECT_ID) {
        tasksUrl += '?projectId=' + encodeURIComponent(WB_FILTER_PROJECT_ID);
      }
      var res = await fetch(tasksUrl);
      var data = await res.json().catch(function () { return {}; });
      if (!res.ok || !data.ok) throw new Error(data.error || ('HTTP ' + res.status));
      allTasksCache = data.tasks || [];
      var kNeeds = 0, kWait = 0, kRun = 0;
      allTasksCache.forEach(function (t) {
        var b = String(t.attentionBucket || '');
        if (b === 'needs_manager') kNeeds++;
        else if (b === 'waiting_employee') kWait++;
        else if (b === 'employee_running' || b === 'blocked') kRun++;
      });
      setText('kpiNeedsMgr', String(kNeeds));
      setText('kpiWaiting', String(kWait));
      setText('kpiRunning', String(kRun));

      var sel = document.getElementById('reassignPlanId');
      if (!allTasksCache.length) {
        document.getElementById('taskTableMount').innerHTML = '<div class="empty-state">暂无任务。请到钉钉与机器人发起规划并发布。</div>';
        wbPopulateReassignPlanPicker([]);
        setText('kpiNeedsMgr', '0');
        setText('kpiWaiting', '0');
        setText('kpiRunning', '0');
        var meta0 = document.getElementById('filterResultMeta');
        if (meta0) meta0.textContent = '共 0 条 · 当前显示 0 条';
        setFb('tableFeedback', '', 'muted');
        return;
      }

      applyFiltersAndSort();

      wbPopulateReassignPlanPicker(wbReassignEligibleTasks(allTasksCache));

      var pageQs = '';
      try {
        pageQs = String(window.location.search || '');
      } catch (e0) {
        pageQs = '';
      }
      var usp = new URLSearchParams(pageQs);
      var focusPlanId = String(usp.get('planId') || '').trim() || String(${JSON.stringify(params.planId ?? "")} || '').trim();
      var focusTab = String(usp.get('focus') || '').trim().toLowerCase();
      var focusSubtaskId = String(usp.get('subtaskId') || '').trim();
      if (focusPlanId) {
        var match = allTasksCache.find(function (t) { return String(t.planId || '') === focusPlanId; });
        if (match) wbSetReassignPlanPicker(match.planId, match.taskNo || '', wbReassignTaskShortLabel(match));
      }
      if (focusTab === 'reassign') {
        setActiveTab('mgrPanelReassign');
      }
      await loadSubtasksForReassign();
      if (focusSubtaskId) {
        var subLi = document.querySelector('#reassignSubtaskOptions [data-subtask-id="' + focusSubtaskId.replace(/"/g, '\\"') + '"]');
        if (subLi) wbSetReassignSubtaskPicker(focusSubtaskId, subLi.getAttribute('data-label'));
      }

      setFb('tableFeedback', '已更新', 'ok');
    } catch (e) {
      document.getElementById('taskTableMount').innerHTML = '<div class="empty-state">加载失败，请稍后重试。</div>';
      setFb('tableFeedback', String(e && e.message ? e.message : e), 'err');
    }
  }

  document.getElementById('reassignBtn').addEventListener('click', async function () {
    var planId = (document.getElementById('reassignPlanId').value || '').trim();
    var assigneeUserId = (document.getElementById('reassignAssigneeUserId').value || '').trim();
    var note = (document.getElementById('reassignNote').value || '').trim();
    var subPick = document.getElementById('reassignSubtaskPick');
    var subtaskId = subPick ? String(subPick.value || '').trim() : '';
    if (!planId) { setFb('reassignFeedback', '请选择任务', 'err'); return; }
    if (!assigneeUserId) { setFb('reassignFeedback', '请先查找并选择新负责人', 'err'); return; }
    var btn = document.getElementById('reassignBtn');
    btn.disabled = true;
    setFb('reassignFeedback', '保存中…', 'muted');
    try {
      var payload = { planId: planId, assigneeUserId: assigneeUserId, note: note };
      if (subtaskId) payload.subtaskId = subtaskId;
      if (WB_ENFORCE_ACTION_GUARDS) {
        var c = document.getElementById('mgrReassignConfirm');
        if (!c || !c.checked) {
          setFb('reassignFeedback', '请勾选确认执行改派', 'err');
          btn.disabled = false;
          return;
        }
        payload.confirm = true;
        payload.idempotencyKey = 'reassign-' + planId + (subtaskId ? '-' + subtaskId : '');
      }
      var res = await fetch('/api/workbench/manager/reassign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      var data = await res.json().catch(function () { return {}; });
      if (!res.ok || !data.ok) throw new Error(data.error || ('HTTP ' + res.status));
      setFb('reassignFeedback', '改派已保存', 'ok');
      if (WB_ENFORCE_ACTION_GUARDS) {
        var cDone = document.getElementById('mgrReassignConfirm');
        if (cDone) cDone.checked = false;
      }
      document.getElementById('reassignAssigneeInput').value = '';
      document.getElementById('reassignAssigneeUserId').value = '';
      var reassignOpts = document.getElementById('reassignAssigneeOptions');
      if (reassignOpts) { reassignOpts.hidden = true; reassignOpts.innerHTML = ''; }
      document.getElementById('reassignNote').value = '';
      wbSetReassignSubtaskPicker('', '全部子任务（未完成）');
      await loadTasks();
    } catch (e) {
      setFb('reassignFeedback', String(e && e.message ? e.message : e), 'err');
    } finally {
      btn.disabled = false;
    }
  });

  document.getElementById('logoutBtn').addEventListener('click', async function () {
    var res = await fetch('/api/workbench/logout', { method: 'POST' });
    var data = {};
    try { data = await res.json(); } catch (e) {}
    window.location.href = (data && data.redirectTo) ? data.redirectTo : '/workbench';
  });

  var filterApplyBtn = document.getElementById('filterApplyBtn');
  var filterClearBtn = document.getElementById('filterClearBtn');
  if (filterApplyBtn) filterApplyBtn.addEventListener('click', applyFiltersSortAndPersist);
  if (filterClearBtn) filterClearBtn.addEventListener('click', clearFilters);
  document.querySelectorAll('.mgr-filter-seg button[data-attention]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      setFilterAttention(String(btn.getAttribute('data-attention') || ''));
    });
  });
  var filterAttEl = document.getElementById('filterAttention');
  if (filterAttEl) {
    filterAttEl.addEventListener('change', function () {
      syncMgrFilterSeg(String(filterAttEl.value || ''));
      applyFiltersSortAndPersist();
    });
    syncMgrFilterSeg(String(filterAttEl.value || 'needs_manager'));
  }
  wbRestoreListStateFromUrl();
  ${portfolio ? buildWorkbenchTasksPortfolioClientJs({ initialProjectId, initialView }) : "void loadTasks();"}
})();
</script>${hasQualityTasks ? `<script>${buildManagerQualityClientJs()}</script>` : ""}`,
  });
}

export function renderManagerChatPage(params: {
  threadId?: string;
  threadKind?: "main" | "side";
  planTitle?: string;
  userLabel?: string;
  sessionUserId?: string;
  openDraftEditor?: boolean;
  projectPortfolioEnabled?: boolean;
  showAdminOpsLink?: boolean;
}): string {
  const initialThreadId = params.threadId ?? "main";
  const initialKind = params.threadKind ?? "main";
  const initialTitle = params.planTitle ?? (initialKind === "main" ? "钉钉规划助手" : "新规划会话");
  const initialOpenDraftEditor = Boolean(params.openDraftEditor);
  const portfolio = Boolean(params.projectPortfolioEnabled);
  return renderWorkbenchPage({
    role: "manager",
    activeNav: "mgr-chat",
    title: "智能规划助手",
    pageTitle: "智能规划助手 · 主管工作台",
    userLabel: params.userLabel,
    sessionUserId: params.sessionUserId,
    portfolioEnabled: portfolio,
    showAdminOpsLink: params.showAdminOpsLink,
    bodyClass: "page-shell--chat manager-chat-v2-page",
    hideMainHead: true,
    extraCss: MANAGER_CHAT_V2_CSS,
    mainHtml: `
  <div class="chat-main manager-chat-v2" id="chatMain">
    <div class="chat-overlay-backdrop" id="chatOverlayBackdrop" hidden aria-hidden="true"></div>

    <aside class="chat-sidebar" id="chatSidebar" aria-label="会话列表">
      <div class="chat-sidebar-head">
        <div class="chat-sidebar-title"><strong>对话历史</strong><span>任务规划记录</span></div>
        <button type="button" class="btn btn-primary btn-sm" id="newThreadBtn" style="width:100%;">+ 新规划会话</button>
      </div>
      <ul class="chat-thread-list" id="threadList"><li class="muted" style="padding:8px;">加载中…</li></ul>
      <div class="chat-sidebar-tip">与助手对话可拆解任务、点将并发布。Enter 发送，Shift+Enter 换行。</div>
    </aside>

    <div class="chat-pane">
      <header class="chat-mobile-top" aria-label="会话导航">
        <button type="button" class="chat-icon-btn" id="openThreadDrawerBtn" aria-label="打开会话列表" aria-expanded="false">☰</button>
        <div class="chat-mobile-top__title">
          <strong id="mobilePaneTitle">${escapeHtml(initialTitle)}</strong>
          <em id="mobilePaneSub">${initialKind === "main" ? "主线程" : "侧会话"}</em>
        </div>
        <button type="button" class="chat-icon-btn" id="newThreadBtnMobile" aria-label="新规划会话">＋</button>
      </header>

      <div class="chat-pane-head chat-pane-head--desktop">
        <div>
          <h2 class="chat-pane-title" id="paneTitle">${escapeHtml(initialTitle)}</h2>
          <div class="chat-pane-sub chat-pane-sub--hidden" id="paneSub">与规划助手协作</div>
        </div>
        <div class="chat-pane-head-actions">
          <span class="chat-thread-badge" id="paneBadge">${initialKind === "main" ? "主线程" : "侧会话"}</span>
        </div>
      </div>

      <div class="draft-context-bar is-muted" id="draftContextBar">
        <span id="draftContextText">暂无草案</span>
      </div>

      <section class="planning-context-card" id="planningContextCard" hidden aria-label="当前任务背景">
        <div class="planning-context-head">
          <div class="planning-context-title">
            <span class="planning-context-icon" id="planningContextIcon" aria-hidden="true">任</span>
            <span><strong id="planningContextTitle">当前任务</strong><small id="planningContextKicker">任务规划上下文 · 只读</small></span>
          </div>
          <button type="button" class="planning-context-toggle" id="planningContextToggle" aria-label="收起任务背景" aria-expanded="true">⌄</button>
        </div>
        <div class="planning-context-body">
          <div class="planning-context-copy"><span id="planningContextDescriptionLabel">任务背景</span><p id="planningContextDescription">—</p></div>
          <div class="planning-context-meta"><span>当前草案</span><strong id="planningContextMeta">—</strong></div>
          <div class="quality-planning-enhancer" id="qualityPlanningEnhancer" hidden>
            <div><strong>需要更完整的执行规划？</strong><span>机器人会结合当前质量背景完善待确认草案，不会自动发放。</span></div>
            <button class="btn btn-primary btn-sm" id="qualityPlanningEnhanceBtn" type="button">让机器人完善任务规划</button>
          </div>
        </div>
      </section>

      <section class="chat-message-pane">
        <div class="chat-stream" id="chatStream" aria-live="polite">
          <ul class="msg-list" id="msgList"></ul>
          <section class="planning-draft-board" id="planningDraftBoard" hidden aria-label="任务分配草案">
            <header class="planning-draft-board-head">
              <div><h3>任务分配草案</h3><p id="planningDraftBoardHint">确认任务内容、负责人和期限后再发放。</p></div>
              <span class="planning-draft-state" id="planningDraftState">待补充</span>
            </header>
            <div id="planningTaskCards"></div>
          </section>
        </div>

        <div class="draft-mobile-bar" id="draftMobileBar" hidden>
          <button type="button" class="draft-mobile-chip" id="openDraftSheetBtn" aria-expanded="false">
            <span class="draft-mobile-chip__icon" aria-hidden="true">草</span>
            <span class="draft-mobile-chip__main">
              <span class="draft-mobile-chip__title" id="draftChipTitle">草案</span>
              <span class="draft-mobile-chip__meta" id="draftChipMeta">—</span>
            </span>
            <span class="draft-mobile-chip__chev" aria-hidden="true">▴</span>
          </button>
        </div>

        <div class="chat-composer-wrap">
          <div class="chat-composer-pill">
            <textarea id="msgInput" rows="1" placeholder="输入任务描述…" aria-label="输入消息，Enter 发送，Shift+Enter 换行"></textarea>
            <button type="button" class="chat-send-btn" id="sendBtn" aria-label="发送" disabled>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><path d="M12 19V5"/><path d="m5 12 7-7 7 7"/></svg>
            </button>
          </div>
          <div class="chat-composer-extra">
            <label class="btn btn-ghost btn-sm chat-roster-btn" for="rosterFileInput">上传花名册</label>
            <input id="rosterFileInput" type="file" accept=".md,.markdown,.txt,.docx,.pdf" hidden />
            <span class="muted chat-roster-status" id="rosterStatus"></span>
          </div>
          <p class="chat-composer-hint">Enter 发送 · Shift+Enter 换行</p>
          <div class="composer-status muted" id="sendFeedback" hidden></div>
        </div>
      </section>
    </div>

    <aside class="draft-context-panel draft-context-panel--empty" id="draftContextPanel" aria-label="草案上下文" data-state="empty">
      <button type="button" class="draft-sheet-close chat-icon-btn" id="closeDraftSheetBtn" aria-label="收起草案">×</button>
      <div class="draft-sheet-grab" aria-hidden="true"></div>
      <div class="draft-panel-empty-wrap" id="draftPanelEmptyWrap">
        <div class="draft-panel-empty-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1"/></svg>
        </div>
        <h3 class="draft-panel-empty-title">暂无草案</h3>
        <p class="draft-panel-empty" id="draftPanelEmpty">本会话暂无草案，在下方输入任务开始规划。</p>
      </div>
      <div class="draft-panel-body" id="draftPanelBody" hidden>
        <div class="draft-panel__head">
          <div class="draft-panel__title-row">
            <h3 class="draft-panel__title">分配摘要 <span class="draft-count-badge" id="draftStatCount">0</span></h3>
          </div>
          <div class="draft-panel__meta">
            <div class="draft-assign-progress">
              <div class="draft-assign-progress__bar"><div class="draft-assign-progress__fill" id="draftProgressFill" style="width:0%"></div></div>
              <span class="draft-assign-progress__label" id="draftProgressLabel"><em>0/0</em> 已指派</span>
            </div>
            <div class="draft-due-row" id="draftDueRow" hidden>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>
              总期限 <strong id="draftStatDue">—</strong>
            </div>
            <button type="button" class="btn-draft-edit-table" id="editDraftBtnPanel" hidden title="编辑草案">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18M15 3v18"/></svg>
              <span class="draft-edit-label-long">编辑草案</span><span class="draft-edit-label-short">编辑</span>
            </button>
          </div>
        </div>
        <div class="draft-panel__list" id="draftPreviewList" role="list"></div>
        <div class="draft-panel__foot">
          <button type="button" class="btn-draft-publish" id="publishDraftBtnPanel" hidden>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4Z"/></svg>
            确认分配并发放
          </button>
          <button type="button" class="btn btn-ghost btn-sm draft-panel-collapse-btn" id="draftPanelCollapseBtn" aria-expanded="true">收起草案面板</button>
          <p class="draft-foot-caption" id="draftFootCaption">发放前将再次执行后端预检与确认</p>
        </div>
      </div>
    </aside>
  </div>

<div class="wb-modal-overlay" id="publishPrepareModalOverlay" role="dialog" aria-modal="true" aria-labelledby="publishPrepareModalTitle">
  <div class="wb-modal" role="document">
    <div class="wb-modal__head">
      <h3 class="wb-modal__title" id="publishPrepareModalTitle">发放预检</h3>
      <button type="button" class="wb-modal__close" id="publishPrepareModalClose" aria-label="关闭">×</button>
    </div>
    <div class="wb-modal__body">
      <p id="publishPrepareSummary" style="margin:0 0 10px;font-size:14px;line-height:1.6;color:#334155;">—</p>
      <p id="publishPrepareWarn" class="muted" style="display:none;margin:0;font-size:13px;color:#b45309;">仍有未指派子任务，预检可能提示需先完成点将。</p>
      <p class="muted" style="margin:10px 0 0;font-size:13px;">将在对话中展示发放预览，确认后再正式下发。</p>
    </div>
    <div class="wb-modal__foot">
      <button type="button" class="btn btn-secondary" id="publishPrepareCancelBtn">取消</button>
      <button type="button" class="btn btn-primary" id="publishPrepareContinueBtn">继续预检</button>
    </div>
  </div>
</div>

<div class="wb-modal-overlay" id="publishConfirmModalOverlay" role="dialog" aria-modal="true" aria-labelledby="publishConfirmModalTitle">
  <div class="wb-modal" role="document">
    <div class="wb-modal__head">
      <h3 class="wb-modal__title" id="publishConfirmModalTitle">确认发放</h3>
      <button type="button" class="wb-modal__close" id="publishConfirmModalClose" aria-label="关闭">×</button>
    </div>
    <div class="wb-modal__body">
      <p style="margin:0;font-size:14px;line-height:1.6;color:#334155;">预览已在左侧对话中展示。确认后将正式发放给员工，此操作不可从本页撤销。</p>
    </div>
    <div class="wb-modal__foot">
      <button type="button" class="btn btn-secondary" id="publishConfirmCancelBtn">取消</button>
      <button type="button" class="btn btn-primary" id="publishConfirmOkBtn">确认发放</button>
    </div>
  </div>
</div>

<div class="wb-modal-overlay planning-person-modal" id="planningPersonModalOverlay" role="dialog" aria-modal="true" aria-labelledby="planningPersonModalTitle">
  <div class="wb-modal" role="document">
    <div class="wb-modal__head">
      <h3 class="wb-modal__title" id="planningPersonModalTitle">选择负责人</h3>
      <button type="button" class="wb-modal__close" id="planningPersonModalClose" aria-label="关闭">×</button>
    </div>
    <div class="wb-modal__body">
      <p class="planning-person-task" id="planningPersonTask">—</p>
      <label for="planningPersonSearch" class="muted" style="display:block;margin-bottom:6px;font-size:12px;font-weight:700;">搜索真实通讯录</label>
      <input class="planning-person-search" id="planningPersonSearch" type="search" autocomplete="off" placeholder="输入姓名、部门或职位" />
      <div class="planning-person-results" id="planningPersonResults"><div class="planning-person-empty">输入至少 1 个字开始搜索</div></div>
      <div class="composer-status muted" id="planningPersonFeedback" hidden></div>
    </div>
    <div class="wb-modal__foot">
      <button type="button" class="btn btn-secondary" id="planningPersonCancelBtn">取消</button>
      <button type="button" class="btn btn-primary" id="planningPersonConfirmBtn" disabled>提交给助手</button>
    </div>
  </div>
</div>`,
    scriptHtml: `<script src="/static/workbench-draft-grid.js"></script>
<script>
(function () {
  ${buildWorkbenchViewSwitchClientJs()}
  wbBindViewSwitchLink('navMyTasks', 'employee', '/workbench/employee?view=new');
  var activeThreadId = ${JSON.stringify(initialThreadId)};
  var activeThreadKind = ${JSON.stringify(initialKind)};
  var activeHasDraft = false;
  var pendingOpenDraftEditor = ${JSON.stringify(initialOpenDraftEditor)};
  var sendInFlight = false;
  var loadSeq = 0;
  var pendingElapsedTimer = null;
  var publishFlowState = 'idle';
  var activeQualitySourceContext = null;
  var qualityPlanningInFlight = false;
  var QUALITY_TASK_REPLAN_MSG = ${JSON.stringify(QUALITY_TASK_REPLAN_MESSAGE)};
  var cachedDraftSummary = {
    count: 0,
    unassigned: 0,
    nearestDue: '',
    latestDue: '',
    missingDue: 0,
    missingDeliverables: 0,
    missingCriteria: 0,
    readyToPublish: false
  };
  var planningPersonTask = null;
  var planningPersonChoice = null;
  var planningPersonSearchTimer = null;
  var planningPersonSearchSeq = 0;
  var PUBLISH_PREPARE_MSG = '请对当前草案做发放预检并展示预览';
  var PUBLISH_CONFIRM_MSG = '确认发放';

  function escapeHtml(s) {
    return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
  function setComposerStatus(msg, kind) {
    var el = document.getElementById('sendFeedback');
    if (!el) return;
    if (!msg) {
      el.hidden = true;
      el.textContent = '';
      el.className = 'composer-status muted';
      return;
    }
    el.hidden = false;
    el.textContent = msg;
    el.className = 'composer-status ' + (kind || 'muted');
  }
  function roleClass(role) {
    var normalized = String(role || '').toLowerCase();
    if (normalized === 'user') return 'msg-bubble--user';
    if (normalized === 'assistant') return 'msg-bubble--assistant';
    return 'msg-bubble--system';
  }
  function scrollMessageStreamToBottom() {
    var stream = document.getElementById('chatStream');
    if (!stream) return;
    stream.scrollTop = stream.scrollHeight;
  }
  var msgInput = document.getElementById('msgInput');
  function focusComposer() {
    if (!msgInput) return;
    requestAnimationFrame(function () {
      msgInput.focus();
      var composer = document.querySelector('.chat-composer-wrap');
      if (composer && window.innerWidth <= 860) {
        composer.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    });
  }
  function roleLabel(role) {
    var r = String(role || '').toLowerCase();
    if (r === 'user') return '我';
    if (r === 'assistant') return '规划助手';
    return '系统';
  }
  function formatMsgTime(at) {
    if (!at) return '';
    try {
      var d = new Date(at);
      if (isNaN(d.getTime())) return '';
      return d.toLocaleString('zh-CN', { hour12: false, month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    } catch (e) { return ''; }
  }
  function messagesQuery() {
    if (activeThreadKind === 'side' && activeThreadId && activeThreadId !== 'main') {
      return '/api/workbench/conversation/messages?thread=side&threadId=' + encodeURIComponent(activeThreadId);
    }
    return '/api/workbench/conversation/messages?thread=main';
  }
  function draftQuery() {
    if (activeThreadKind === 'side' && activeThreadId && activeThreadId !== 'main') {
      return '/api/workbench/conversation/draft?thread=side&threadId=' + encodeURIComponent(activeThreadId);
    }
    return '/api/workbench/conversation/draft?thread=main';
  }
  function threadUrl(threadId, kind) {
    if (kind === 'side' && threadId && threadId !== 'main') {
      return '/workbench/manager/chat?thread=side&threadId=' + encodeURIComponent(threadId);
    }
    return '/workbench/manager/chat?thread=main';
  }
  function updatePaneHeader(meta) {
    var title = meta.title || '智能规划助手';
    document.getElementById('paneTitle').textContent = title;
    document.getElementById('paneBadge').textContent = meta.badge || (meta.kind === 'main' ? '主线程' : '侧会话');
    var mobileTitle = document.getElementById('mobilePaneTitle');
    var mobileSub = document.getElementById('mobilePaneSub');
    if (mobileTitle) mobileTitle.textContent = title;
    if (mobileSub) {
      var subParts = [meta.badge || (meta.kind === 'main' ? '主线程' : '侧会话')];
      if (meta.hasDraft && cachedDraftSummary.count) {
        subParts.push(cachedDraftSummary.count + ' 条子任务草案');
      }
      mobileSub.textContent = subParts.join(' · ');
    }
    var sub = document.getElementById('paneSub');
    if (sub) {
      if (meta.hasDraft) {
        sub.textContent = '草案未发布 · 可继续对话或编辑表格';
        sub.classList.remove('chat-pane-sub--hidden');
      } else {
        sub.classList.add('chat-pane-sub--hidden');
      }
    }
  }
  function syncSendBtnState() {
    var sendBtn = document.getElementById('sendBtn');
    var inputEl = document.getElementById('msgInput');
    if (!sendBtn || !inputEl) return;
    var hasText = !!String(inputEl.value || '').trim();
    sendBtn.disabled = sendInFlight || !hasText;
  }
  function setChatOverlay(open) {
    var backdrop = document.getElementById('chatOverlayBackdrop');
    var main = document.getElementById('chatMain');
    if (backdrop) backdrop.hidden = !open;
    if (main) main.classList.toggle('is-overlay-open', !!open);
    document.body.classList.toggle('chat-overlay-lock', !!open);
  }
  function closeThreadDrawer() {
    var main = document.getElementById('chatMain');
    var btn = document.getElementById('openThreadDrawerBtn');
    if (main) main.classList.remove('is-thread-drawer-open');
    if (btn) btn.setAttribute('aria-expanded', 'false');
    if (!isDraftSheetOpen()) setChatOverlay(false);
  }
  function openThreadDrawer() {
    var main = document.getElementById('chatMain');
    var btn = document.getElementById('openThreadDrawerBtn');
    if (main) main.classList.add('is-thread-drawer-open');
    if (btn) btn.setAttribute('aria-expanded', 'true');
    setChatOverlay(true);
  }
  function isDraftSheetOpen() {
    var main = document.getElementById('chatMain');
    return !!(main && main.classList.contains('is-draft-sheet-open'));
  }
  function closeDraftSheet() {
    var main = document.getElementById('chatMain');
    var chipBtn = document.getElementById('openDraftSheetBtn');
    if (main) main.classList.remove('is-draft-sheet-open');
    if (chipBtn) chipBtn.setAttribute('aria-expanded', 'false');
    if (!main || !main.classList.contains('is-thread-drawer-open')) {
      setChatOverlay(false);
    }
  }
  function openDraftSheet() {
    if (!activeHasDraft) return;
    var main = document.getElementById('chatMain');
    var chipBtn = document.getElementById('openDraftSheetBtn');
    if (main) main.classList.add('is-draft-sheet-open');
    if (chipBtn) chipBtn.setAttribute('aria-expanded', 'true');
    setChatOverlay(true);
  }
  function openPublishModal(overlayId) {
    var el = document.getElementById(overlayId);
    if (el) el.setAttribute('data-open', 'true');
  }
  function closePublishModal(overlayId) {
    var el = document.getElementById(overlayId);
    if (el) el.setAttribute('data-open', 'false');
  }
  function closeAllPublishModals() {
    closePublishModal('publishPrepareModalOverlay');
    closePublishModal('publishConfirmModalOverlay');
  }
  function resetPublishFlow() {
    publishFlowState = 'idle';
    closeAllPublishModals();
    updatePublishBtnUi();
  }
  function updatePublishBtnUi() {
    var btn = document.getElementById('publishDraftBtnPanel');
    if (!btn) return;
    btn.disabled = sendInFlight || !activeHasDraft || !cachedDraftSummary.readyToPublish;
    var label = (sendInFlight && publishFlowState === 'preparing') ? '预检中…' : '确认分配并发放';
    btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4Z"/></svg>' + label;
  }
  function openPublishPrepareModal() {
    if (!activeHasDraft || sendInFlight) return;
    if (!cachedDraftSummary.readyToPublish) {
      setComposerStatus('请先补全负责人、期限、交付物和完成标准', 'err');
      return;
    }
    var sumEl = document.getElementById('publishPrepareSummary');
    var warnEl = document.getElementById('publishPrepareWarn');
    var s = cachedDraftSummary;
    var line = s.count + ' 条子任务 · ' + s.assigned + '/' + s.count + ' 已指派';
    if (s.latestDue) line += ' · 总期限 ' + s.latestDue;
    if (sumEl) sumEl.textContent = line;
    if (warnEl) warnEl.style.display = 'none';
    openPublishModal('publishPrepareModalOverlay');
  }
  function applyDraftPanelUi(hasDraft) {
    activeHasDraft = hasDraft;
    var btn = document.getElementById('editDraftBtnPanel');
    var pubBtn = document.getElementById('publishDraftBtnPanel');
    if (btn) btn.hidden = !hasDraft;
    if (pubBtn) pubBtn.hidden = !hasDraft;
    var panel = document.getElementById('draftContextPanel');
    var emptyWrap = document.getElementById('draftPanelEmptyWrap');
    var emptyHint = document.getElementById('draftPanelEmpty');
    var body = document.getElementById('draftPanelBody');
    if (panel) {
      panel.classList.toggle('draft-context-panel--empty', !hasDraft);
      if (!hasDraft) panel.setAttribute('data-state', 'empty');
    }
    if (emptyWrap) emptyWrap.hidden = hasDraft;
    if (emptyHint) emptyHint.hidden = false;
    if (body) body.hidden = !hasDraft;
    if (!hasDraft) resetPublishFlow();
    updatePublishBtnUi();
  }
  function resetDraftPanelForThreadSwitch() {
    resetPublishFlow();
    applyDraftPanelUi(false);
    updateDraftContext({ count: 0, unassigned: 0, assigned: 0, nearestDue: '', preview: [] }, false);
  }
  function parseAssigneeCell(raw) {
    var s = String(raw || '').trim();
    if (!s) return '';
    var m = s.match(/^(.+?)\\s*\\([^)]+\\)\\s*$/);
    return m ? m[1].trim() : s;
  }
  function assigneeInitial(name) {
    var n = String(name || '').trim();
    if (!n) return '?';
    return n.charAt(0);
  }
  function avatarTone(userId) {
    var h = 0;
    var s = String(userId || 'x');
    for (var i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
    return 'draft-avatar--tone-' + (Math.abs(h) % 4);
  }
  function renderDraftTaskRow(item) {
    var pending = !item.assigned;
    var rowClass = 'draft-task-row' + (pending ? ' draft-task-row--pending' : '');
    var assigneeHtml;
    if (pending) {
      assigneeHtml = '<div class="draft-assignee"><span class="draft-avatar draft-avatar--pending">?</span></div>';
    } else {
      var init = escapeHtml(assigneeInitial(item.assigneeName));
      var tone = avatarTone(item.userId || item.assigneeName);
      var nameHtml = item.assigneeName
        ? '<span class="draft-assignee__name">' + escapeHtml(item.assigneeName) + '</span>'
        : '';
      assigneeHtml = '<div class="draft-assignee"><span class="draft-avatar ' + tone + '">' + init + '</span>' + nameHtml + '</div>';
    }
    var subHtml = pending ? '<div class="draft-task-row__sub">待指派</div>' : '';
    return '<div class="' + rowClass + '" role="listitem">'
      + '<span class="draft-task-row__dot" aria-hidden="true"></span>'
      + '<div class="draft-task-row__body"><div class="draft-task-row__title">' + escapeHtml(item.title) + '</div>' + subHtml + '</div>'
      + assigneeHtml
      + '</div>';
  }
  function computeDraftSummary(draftData) {
    var rows = draftData.rows || [];
    var tasks = (draftData.draft && draftData.draft.tasks) || [];
    var assignments = (draftData.assignment && draftData.assignment.assignments) || [];
    var byTask = {};
    var nameByTask = {};
    assignments.forEach(function (a) {
      var tid = String(a.taskId || '').trim();
      var primary = a.primary || {};
      var uid = primary && String(primary.userId || '').trim();
      var name = primary && String(primary.displayName || '').trim();
      if (tid && uid) {
        byTask[tid] = uid;
        if (name) nameByTask[tid] = name;
      }
    });
    var items = rows.length ? rows : tasks.map(function (t, i) {
      return {
        taskId: t.id,
        title: t.title,
        objective: t.objective || '',
        deliverables: Array.isArray(t.deliverables) ? t.deliverables.join('；') : (t.deliverables || ''),
        completionCriteria: Array.isArray(t.completionCriteria) ? t.completionCriteria.join('；') : (t.completionCriteria || ''),
        dueAt: (t.timeNode && t.timeNode.dueAt) || t.dueAt || '',
        actions: Array.isArray(t.actions) ? t.actions.join('；') : (t.actions || ''),
        dependencyTaskIds: Array.isArray(t.dependencyTaskIds) ? t.dependencyTaskIds.join('；') : (t.dependencyTaskIds || '')
      };
    });
    var dues = [];
    var unassigned = 0;
    var missingDue = 0;
    var missingDeliverables = 0;
    var missingCriteria = 0;
    var cards = items.map(function (r, idx) {
      var tid = String(r.taskId || r.id || ('task_' + (idx + 1))).trim();
      var title = String(r.title || tid || '子任务').trim();
      var assigned = Boolean(byTask[tid]);
      var assigneeName = nameByTask[tid] || '';
      if (!assigneeName && assigned && r.assignee) assigneeName = parseAssigneeCell(r.assignee);
      var dueAt = String(r.dueAt || '').trim();
      var dueComplete = Boolean(dueAt && dueAt !== '待确认' && /^\\d{4}-\\d{2}-\\d{2}/.test(dueAt));
      var deliverables = String(r.deliverables || '').trim();
      var completionCriteria = String(r.completionCriteria || '').trim();
      if (!assigned) unassigned += 1;
      if (!dueComplete) missingDue += 1;
      else dues.push(dueAt.slice(0, 10));
      if (!deliverables) missingDeliverables += 1;
      if (!completionCriteria) missingCriteria += 1;
      return {
        taskId: tid,
        title: title,
        objective: String(r.objective || '').trim() || title,
        deliverables: deliverables,
        completionCriteria: completionCriteria,
        dueAt: dueAt,
        dueComplete: dueComplete,
        actions: String(r.actions || '').trim(),
        dependencies: String(r.dependencyTaskIds || '').trim(),
        assigned: assigned,
        assigneeName: assigneeName,
        userId: byTask[tid] || ''
      };
    });
    dues.sort();
    var count = cards.length;
    var assignedCount = Math.max(0, count - unassigned);
    var readyToPublish = count > 0
      && unassigned === 0
      && missingDue === 0
      && missingDeliverables === 0
      && missingCriteria === 0;
    var draftObj = (draftData.draft && typeof draftData.draft === 'object') ? draftData.draft : {};
    var qualityHandoff = (draftObj.qualityHandoff && typeof draftObj.qualityHandoff === 'object') ? draftObj.qualityHandoff : {};
    var rawSource = (draftData.sourceContext && typeof draftData.sourceContext === 'object')
      ? draftData.sourceContext
      : ((draftObj.sourceContext && typeof draftObj.sourceContext === 'object') ? draftObj.sourceContext : {});
    var qualityEventId = String(rawSource.qualityEventId || qualityHandoff.qualityEventId || '').trim();
    var sourceKind = String(rawSource.kind || (qualityEventId ? 'quality_event' : '')).trim();
    return {
      count: count,
      unassigned: unassigned,
      assigned: assignedCount,
      nearestDue: dues[0] || '',
      latestDue: dues.length ? dues[dues.length - 1] : '',
      missingDue: missingDue,
      missingDeliverables: missingDeliverables,
      missingCriteria: missingCriteria,
      readyToPublish: readyToPublish,
      preview: cards.slice(0, 8),
      cards: cards,
      title: String((draftData.draft && draftData.draft.title) || draftData.title || '').trim(),
      description: String((draftData.draft && (draftData.draft.description || draftData.draft.summary)) || draftData.description || '').trim(),
      sourceContext: sourceKind ? { kind: sourceKind, qualityEventId: qualityEventId } : null
    };
  }
  function renderPlanningCheck(label, ok, detail) {
    return '<div class="planning-check-item' + (ok ? ' is-ok' : '') + '" role="listitem">'
      + '<span class="planning-check-icon" aria-hidden="true">' + (ok ? '✓' : '!') + '</span>'
      + '<span class="planning-check-copy"><strong>' + escapeHtml(label) + '</strong><small>' + escapeHtml(detail) + '</small></span>'
      + '</div>';
  }
  function renderPlanningTaskCard(task, idx) {
    var assigned = Boolean(task.assigned);
    var assigneeName = String(task.assigneeName || '').trim();
    var assignee = assigned
      ? '<span class="planning-task-assignee"><span class="planning-task-avatar">' + escapeHtml(assigneeInitial(assigneeName)) + '</span><strong>' + escapeHtml(assigneeName || task.userId) + '</strong></span>'
      : '<span class="planning-task-assignee"><span class="planning-task-avatar is-pending">?</span><strong>待主管指定</strong></span>';
    var details = [];
    if (task.actions) details.push('执行动作：' + task.actions);
    if (task.dependencies) details.push('前置依赖：' + task.dependencies);
    var detailsHtml = details.length
      ? '<details class="planning-task-details"><summary>查看执行动作与前置依赖</summary><p>' + escapeHtml(details.join('\\n')) + '</p></details>'
      : '';
    return '<article class="planning-task-card' + (assigned ? ' is-assigned' : '') + '" data-task-id="' + escapeHtml(task.taskId) + '">'
      + '<span class="planning-task-index" aria-hidden="true">' + (idx + 1) + '</span>'
      + '<div class="planning-task-main">'
      + '<div class="planning-task-title-row"><div><h4 class="planning-task-title">' + escapeHtml(task.title) + '</h4><p class="planning-task-objective"><span>目标</span>' + escapeHtml(task.objective || task.title) + '</p></div>'
      + '<button type="button" class="planning-assignee-button" data-planning-assign="1" data-task-id="' + escapeHtml(task.taskId) + '" data-task-title="' + escapeHtml(task.title) + '">' + (assigned ? '调整人员' : '选择人员') + '</button></div>'
      + '<div class="planning-task-fields">'
      + '<div class="planning-task-field' + (assigned ? '' : ' is-missing') + '"><span>负责人</span>' + assignee + '</div>'
      + '<div class="planning-task-field' + (task.dueComplete ? '' : ' is-missing') + '"><span>截止时间</span><strong>' + escapeHtml(task.dueComplete ? task.dueAt.slice(0, 10) : '待确认') + '</strong></div>'
      + '<div class="planning-task-field' + (task.deliverables ? '' : ' is-missing') + '"><span>交付物</span><p>' + escapeHtml(task.deliverables || '待补充') + '</p></div>'
      + '<div class="planning-task-field' + (task.completionCriteria ? '' : ' is-missing') + '"><span>完成标准</span><p>' + escapeHtml(task.completionCriteria || '待补充') + '</p></div>'
      + '</div>' + detailsHtml + '</div></article>';
  }
  function renderPlanningDraftBoard(summary, hasDraft) {
    var board = document.getElementById('planningDraftBoard');
    var cards = document.getElementById('planningTaskCards');
    var state = document.getElementById('planningDraftState');
    var hint = document.getElementById('planningDraftBoardHint');
    if (!board || !cards) return;
    board.hidden = !hasDraft;
    if (!hasDraft) {
      cards.innerHTML = '';
      return;
    }
    cards.innerHTML = (summary.cards || []).map(renderPlanningTaskCard).join('');
    if (state) {
      state.textContent = summary.readyToPublish ? '可以发放' : '待补充';
      state.classList.toggle('is-ready', Boolean(summary.readyToPublish));
    }
    if (hint) {
      hint.textContent = summary.readyToPublish
        ? '负责人、期限、交付物和完成标准均已完整。'
        : '仍有未完成项，可通过对话或“选择人员”继续调整。';
    }
    bindPlanningTaskButtons();
  }
  function plainPlanningContextText(value) {
    return String(value || '')
      .replace(/^#{1,6}\\s*/gm, '')
      .replace(/\\*\\*([^*]+)\\*\\*/g, '$1')
      .replace(/\\n{3,}/g, '\\n\\n')
      .trim();
  }
  function renderPlanningContext(summary, hasDraft) {
    var card = document.getElementById('planningContextCard');
    if (!card) return;
    card.hidden = !hasDraft;
    if (!hasDraft) {
      activeQualitySourceContext = null;
      updateQualityPlanningEnhancer();
      return;
    }
    var title = document.getElementById('planningContextTitle');
    var desc = document.getElementById('planningContextDescription');
    var meta = document.getElementById('planningContextMeta');
    var icon = document.getElementById('planningContextIcon');
    var kicker = document.getElementById('planningContextKicker');
    var descLabel = document.getElementById('planningContextDescriptionLabel');
    var source = summary.sourceContext || {};
    var isQuality = source.kind === 'quality_event';
    activeQualitySourceContext = isQuality ? source : null;
    updateQualityPlanningEnhancer();
    var eventNo = String(source.qualityEventId || '').trim();
    card.classList.toggle('is-quality', isQuality);
    if (icon) icon.textContent = isQuality ? '质' : '任';
    if (kicker) kicker.textContent = isQuality ? '质量事件交接 · 只读' : '任务规划上下文 · 只读';
    if (descLabel) descLabel.textContent = isQuality ? '质量交接背景' : '任务背景';
    if (title) title.textContent = isQuality
      ? ((eventNo ? '质量事件 ' + eventNo + ' · ' : '') + (summary.title || '任务草案'))
      : (summary.title || '当前任务草案');
    if (desc) desc.textContent = plainPlanningContextText(summary.description) || '当前草案未填写任务背景，可继续在对话中补充。';
    if (meta) meta.textContent = summary.count + ' 项任务 · ' + summary.assigned + '/' + summary.count + ' 已指派';
  }
  function updateQualityPlanningEnhancer() {
    var action = document.getElementById('qualityPlanningEnhancer');
    var button = document.getElementById('qualityPlanningEnhanceBtn');
    if (!action || !button) return;
    var canOffer = !!(activeQualitySourceContext
      && activeQualitySourceContext.kind === 'quality_event'
      && activeThreadKind === 'side');
    action.hidden = !canOffer;
    button.disabled = !canOffer || qualityPlanningInFlight || sendInFlight;
    button.textContent = qualityPlanningInFlight ? '机器人规划中…' : '让机器人完善任务规划';
  }
  function paintDraftPanelSummary(summary, hasDraft) {
    var panel = document.getElementById('draftContextPanel');
    var fill = document.getElementById('draftProgressFill');
    var label = document.getElementById('draftProgressLabel');
    var dueRow = document.getElementById('draftDueRow');
    var d = document.getElementById('draftStatDue');
    var c = document.getElementById('draftStatCount');
    var list = document.getElementById('draftPreviewList');
    var cap = document.getElementById('draftFootCaption');
    var assigned = summary.assigned != null ? summary.assigned : Math.max(0, summary.count - summary.unassigned);
    var pct = summary.count > 0 ? Math.round((assigned / summary.count) * 100) : 0;
    if (panel && hasDraft) {
      panel.setAttribute('data-state', summary.readyToPublish ? 'ready' : 'warn');
      panel.style.setProperty('--draft-pct', pct + '%');
    }
    if (c) c.textContent = String(summary.count);
    if (fill) fill.style.width = pct + '%';
    if (label) label.innerHTML = '<em>' + assigned + '/' + summary.count + '</em> 已指派';
    if (dueRow) dueRow.hidden = !summary.latestDue;
    if (d) d.textContent = summary.latestDue || '—';
    if (list) {
      list.innerHTML = [
        renderPlanningCheck('负责人完整', summary.unassigned === 0, summary.unassigned === 0 ? summary.count + '/' + summary.count + ' 已指定' : '还缺 ' + summary.unassigned + ' 项'),
        renderPlanningCheck('期限完整', summary.missingDue === 0, summary.missingDue === 0 ? '所有任务均有期限' : '还缺 ' + summary.missingDue + ' 项'),
        renderPlanningCheck('交付物完整', summary.missingDeliverables === 0, summary.missingDeliverables === 0 ? '交付物可核对' : '还缺 ' + summary.missingDeliverables + ' 项'),
        renderPlanningCheck('完成标准完整', summary.missingCriteria === 0, summary.missingCriteria === 0 ? '标准可验收' : '还缺 ' + summary.missingCriteria + ' 项')
      ].join('');
    }
    if (cap) {
      cap.textContent = summary.readyToPublish
        ? '发放前将再次执行后端预检与确认'
        : '请先补全右侧未通过的检查项';
    }
    renderPlanningContext(summary, hasDraft);
    renderPlanningDraftBoard(summary, hasDraft);
    updatePublishBtnUi();
  }
  function updateDraftContext(summary, hasDraft) {
    var bar = document.getElementById('draftContextBar');
    var text = document.getElementById('draftContextText');
    var mobileBar = document.getElementById('draftMobileBar');
    var chipTitle = document.getElementById('draftChipTitle');
    var chipMeta = document.getElementById('draftChipMeta');
    var paneTitle = document.getElementById('paneTitle');
    if (!hasDraft) {
      cachedDraftSummary = {
        count: 0,
        unassigned: 0,
        assigned: 0,
        nearestDue: '',
        latestDue: '',
        missingDue: 0,
        missingDeliverables: 0,
        missingCriteria: 0,
        readyToPublish: false,
        preview: []
      };
      if (bar) { bar.classList.add('is-muted'); bar.hidden = false; }
      if (text) text.textContent = '暂无草案';
      if (mobileBar) mobileBar.hidden = true;
      closeDraftSheet();
      paintDraftPanelSummary({ count: 0, unassigned: 0, assigned: 0, nearestDue: '', preview: [] }, false);
      var emptyHint = document.getElementById('draftPanelEmpty');
      if (emptyHint) {
        emptyHint.textContent = activeThreadKind === 'side'
          ? '本侧会话暂无草案，在下方输入任务开始规划。'
          : '本会话暂无草案，在下方输入任务开始规划。';
      }
      applyDraftPanelUi(false);
      return;
    }
    applyDraftPanelUi(true);
    cachedDraftSummary = summary;
    var assigned = summary.assigned != null ? summary.assigned : Math.max(0, summary.count - summary.unassigned);
    var line = summary.count + ' 条子任务 · ' + summary.unassigned + ' 条未指派';
    if (summary.latestDue) line += ' · 总期限 ' + summary.latestDue;
    if (bar) { bar.classList.remove('is-muted'); bar.hidden = false; }
    if (text) text.textContent = line;
    if (mobileBar) mobileBar.hidden = false;
    if (chipTitle) {
      var t = paneTitle ? String(paneTitle.textContent || '').trim() : '';
      chipTitle.textContent = (t || '草案') + ' · ' + summary.count + ' 子任务';
    }
    if (chipMeta) {
      var metaLine = assigned + '/' + summary.count + ' 已指派';
      if (summary.latestDue) metaLine += ' · 总期限 ' + summary.latestDue;
      chipMeta.textContent = metaLine;
    }
    var mobileSub = document.getElementById('mobilePaneSub');
    if (mobileSub) {
      var badgeEl = document.getElementById('paneBadge');
      var badgeText = badgeEl ? String(badgeEl.textContent || '').trim() : '';
      var subParts = badgeText ? [badgeText] : [];
      if (summary.count) subParts.push(summary.count + ' 条子任务草案');
      mobileSub.textContent = subParts.join(' · ');
    }
    paintDraftPanelSummary(summary, true);
  }
  function renderSkeleton() {
    var box = document.getElementById('msgList');
    var stream = document.getElementById('chatStream');
    if (stream) stream.setAttribute('aria-busy', 'true');
    if (box) {
      box.innerHTML = '<li class="chat-skeleton-msg"></li><li class="chat-skeleton-msg"></li><li class="chat-skeleton-msg"></li>';
    }
  }
  function renderEmptyState() {
    var box = document.getElementById('msgList');
    if (!box) return;
    box.innerHTML = '<li class="chat-welcome-wrap"><div class="chat-welcome">'
      + '<div class="chat-welcome__icon" aria-hidden="true">任</div>'
      + '<h3 class="chat-welcome__title">今天要规划什么？</h3>'
      + '<p class="chat-welcome__lead">描述任务背景与期望完成时间，助手将协助拆解子任务并推荐负责人。</p>'
      + '<div class="chat-starter-chips">'
      + '<button type="button" class="chat-starter-chip" data-starter="帮我规划一项新品上市推广任务，期望本季度末完成。">新品上市推广</button>'
      + '<button type="button" class="chat-starter-chip" data-starter="季度合规审计发现 3 项整改，请拆解并指派。">合规审计整改</button>'
      + '</div>'
      + '<p class="chat-welcome__hint"><kbd>Enter</kbd> 发送 · <kbd>Shift</kbd>+<kbd>Enter</kbd> 换行</p>'
      + '</div></li>';
    box.querySelectorAll('.chat-starter-chip').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var starter = btn.getAttribute('data-starter') || '';
        if (!msgInput || !starter) return;
        msgInput.value = starter;
        msgInput.dispatchEvent(new Event('input'));
        syncSendBtnState();
        focusComposer();
      });
    });
  }
  function renderThreadLostState() {
    var box = document.getElementById('msgList');
    if (!box) return;
    box.innerHTML = '<li class="chat-thread-lost-wrap"><div class="chat-thread-lost">'
      + '<div class="chat-thread-lost__icon" aria-hidden="true">⚠</div>'
      + '<h3>找不到该会话</h3>'
      + '<p>可能因本地数据已重置，或会话记录已过期。请返回主线程继续规划，或新建侧会话。</p>'
      + '<div class="chat-thread-lost__actions">'
      + '<button type="button" class="btn btn-primary btn-sm" id="threadLostGoMainBtn">返回主线程</button>'
      + '<button type="button" class="btn btn-ghost btn-sm" id="threadLostNewBtn">新建规划会话</button>'
      + '</div></div></li>';
    var goMain = document.getElementById('threadLostGoMainBtn');
    if (goMain) goMain.addEventListener('click', function () { void switchToMainThread(); });
    var goNew = document.getElementById('threadLostNewBtn');
    if (goNew) goNew.addEventListener('click', function () {
      var btn = document.getElementById('newThreadBtn');
      if (btn) btn.click();
    });
  }
  function isThreadNotFoundError(err) {
    var msg = String(err && err.message ? err.message : err);
    return msg.indexOf('No session found for thread') >= 0;
  }
  async function switchToMainThread() {
    loadSeq += 1;
    var mySeq = loadSeq;
    activeThreadId = 'main';
    activeThreadKind = 'main';
    history.replaceState(null, '', threadUrl('main', 'main'));
    resetDraftPanelForThreadSwitch();
    var list = document.getElementById('threadList');
    if (list) {
      list.querySelectorAll('.chat-thread-item').forEach(function (x) {
        x.classList.toggle('active', (x.getAttribute('data-thread-id') || '') === 'main');
      });
    }
    setComposerStatus('', 'muted');
    await loadThreads('main');
    await loadMessages(mySeq);
    focusComposer();
  }
  function renderMessageRows(msgs) {
    var box = document.getElementById('msgList');
    if (!box) return;
    if (!msgs.length) {
      renderEmptyState();
      return;
    }
    box.innerHTML = msgs.map(function (m) {
      var role = String(m.role || 'system');
      var rl = roleLabel(role);
      var rowClass = role === 'user' ? 'msg-row msg-row--user' : 'msg-row msg-row--assistant';
      if (role === 'system') rowClass = 'msg-row msg-row--system';
      var bubbleClass = 'msg-bubble ' + roleClass(role);
      var tm = formatMsgTime(m.at);
      var metaLine = role === 'assistant'
        ? '<div class="msg-meta">' + escapeHtml(rl) + (tm ? ' · ' + escapeHtml(tm) : '') + '</div>'
        : '';
      var body = (role === 'assistant' && m.html)
        ? '<div class="msg-body msg-body--assistant">' + m.html + '</div>'
        : '<div class="msg-body">' + escapeHtml(m.content || '') + '</div>';
      return '<li class="' + rowClass + '"><div class="' + bubbleClass + '">' + metaLine + body + '</div></li>';
    }).join('');
    collapseLegacyTaskTables();
  }
  function collapseLegacyTaskTables() {
    document.querySelectorAll('.msg-body--assistant table').forEach(function (table) {
      if (table.closest('.legacy-task-table-details')) return;
      var details = document.createElement('details');
      details.className = 'legacy-task-table-details';
      var summary = document.createElement('summary');
      summary.textContent = '查看助手原始任务表';
      var parent = table.parentNode;
      if (!parent) return;
      parent.insertBefore(details, table);
      details.appendChild(summary);
      details.appendChild(table);
      var previous = details.previousElementSibling;
      if (previous && /^H[1-4]$/.test(previous.tagName) && /任务表/.test(previous.textContent || '')) {
        previous.hidden = true;
      }
    });
  }
  function setPlanningPersonFeedback(message, kind) {
    var el = document.getElementById('planningPersonFeedback');
    if (!el) return;
    el.hidden = !message;
    el.textContent = message || '';
    el.className = 'composer-status ' + (kind || 'muted');
  }
  function closePlanningPersonModal() {
    closePublishModal('planningPersonModalOverlay');
    planningPersonSearchSeq += 1;
    planningPersonTask = null;
    planningPersonChoice = null;
    if (planningPersonSearchTimer) clearTimeout(planningPersonSearchTimer);
    planningPersonSearchTimer = null;
    var search = document.getElementById('planningPersonSearch');
    var results = document.getElementById('planningPersonResults');
    var confirm = document.getElementById('planningPersonConfirmBtn');
    if (search) search.value = '';
    if (results) results.innerHTML = '<div class="planning-person-empty">输入至少 1 个字开始搜索</div>';
    if (confirm) confirm.disabled = true;
    setPlanningPersonFeedback('', 'muted');
  }
  function openPlanningPersonModal(taskId, taskTitle) {
    planningPersonTask = { taskId: taskId, title: taskTitle };
    planningPersonChoice = null;
    var task = document.getElementById('planningPersonTask');
    var confirm = document.getElementById('planningPersonConfirmBtn');
    if (task) task.textContent = '任务：' + taskTitle;
    if (confirm) confirm.disabled = true;
    openPublishModal('planningPersonModalOverlay');
    var search = document.getElementById('planningPersonSearch');
    if (search) setTimeout(function () { search.focus(); }, 30);
  }
  function bindPlanningTaskButtons() {
    document.querySelectorAll('[data-planning-assign="1"]').forEach(function (button) {
      button.addEventListener('click', function () {
        var taskId = String(button.getAttribute('data-task-id') || '').trim();
        var taskTitle = String(button.getAttribute('data-task-title') || '').trim();
        if (!taskId || !taskTitle) return;
        openPlanningPersonModal(taskId, taskTitle);
      });
    });
  }
  function renderPlanningPersonOptions(contacts) {
    var results = document.getElementById('planningPersonResults');
    if (!results) return;
    var active = (contacts || []).filter(function (contact) { return contact && contact.active !== false; });
    if (!active.length) {
      results.innerHTML = '<div class="planning-person-empty">未找到匹配的在职成员</div>';
      return;
    }
    results.innerHTML = active.map(function (contact) {
      var name = String(contact.name || contact.userId || '').trim();
      var department = String(contact.departmentSummary || contact.departmentName || '未分配部门').trim();
      return '<button type="button" class="planning-person-option" data-user-id="' + escapeHtml(contact.userId) + '" data-name="' + escapeHtml(name) + '" data-department="' + escapeHtml(department) + '">'
        + '<span class="planning-person-option-avatar">' + escapeHtml(assigneeInitial(name)) + '</span>'
        + '<span><strong>' + escapeHtml(name) + '</strong><small>' + escapeHtml(department) + '</small></span><em>选择</em></button>';
    }).join('');
    results.querySelectorAll('.planning-person-option').forEach(function (option) {
      option.addEventListener('click', function () {
        results.querySelectorAll('.planning-person-option').forEach(function (x) { x.classList.remove('is-selected'); });
        option.classList.add('is-selected');
        planningPersonChoice = {
          userId: String(option.getAttribute('data-user-id') || '').trim(),
          name: String(option.getAttribute('data-name') || '').trim(),
          department: String(option.getAttribute('data-department') || '').trim()
        };
        var confirm = document.getElementById('planningPersonConfirmBtn');
        if (confirm) confirm.disabled = !planningPersonChoice.name;
        setPlanningPersonFeedback('已选择 ' + planningPersonChoice.name + '，提交后由助手核对并更新草案。', 'ok');
      });
    });
  }
  async function searchPlanningPeople(keyword, seq) {
    var results = document.getElementById('planningPersonResults');
    if (results) results.innerHTML = '<div class="planning-person-empty">正在搜索真实通讯录…</div>';
    try {
      var res = await fetch('/api/workbench/manager/contacts?keyword=' + encodeURIComponent(keyword));
      var data = await res.json().catch(function () { return {}; });
      if (seq !== planningPersonSearchSeq) return;
      if (!res.ok || !data.ok) throw new Error(data.error || ('HTTP ' + res.status));
      renderPlanningPersonOptions(data.contacts || []);
    } catch (error) {
      if (seq !== planningPersonSearchSeq) return;
      if (results) results.innerHTML = '<div class="planning-person-empty">通讯录加载失败，请稍后重试</div>';
    }
  }
  function appendPendingBubble(startedAt) {
    var box = document.getElementById('msgList');
    if (!box) return;
    var li = document.createElement('li');
    li.className = 'msg-row msg-row--assistant';
    li.id = 'pendingAssistantMsg';
    li.innerHTML = '<div class="msg-bubble msg-bubble--pending">'
      + '<div class="msg-meta">规划助手</div>'
      + '<div class="msg-body"><span class="typing-dots"><span></span><span></span><span></span></span>正在处理…'
      + '<div class="msg-elapsed" id="pendingElapsed">已等待 0 秒</div></div></div>';
    box.appendChild(li);
    scrollMessageStreamToBottom();
    if (pendingElapsedTimer) clearInterval(pendingElapsedTimer);
    pendingElapsedTimer = setInterval(function () {
      var el = document.getElementById('pendingElapsed');
      if (!el) return;
      var sec = Math.floor((Date.now() - startedAt) / 1000);
      el.textContent = '已等待 ' + sec + ' 秒';
    }, 1000);
  }
  function clearPendingBubble() {
    if (pendingElapsedTimer) { clearInterval(pendingElapsedTimer); pendingElapsedTimer = null; }
    var pending = document.getElementById('pendingAssistantMsg');
    if (pending && pending.parentNode) pending.parentNode.removeChild(pending);
  }
  function openDraftEditorModal() {
    if (!activeHasDraft) {
      setComposerStatus('当前会话没有可编辑的草案', 'err');
      return;
    }
    var grid = window.WorkbenchDraftGrid;
    if (!grid || typeof grid.openDraftExcelModal !== 'function') {
      setComposerStatus('表格编辑器未加载，请刷新页面或联系管理员', 'err');
      return;
    }
    setComposerStatus('', 'muted');
    grid.openDraftExcelModal({
      threadId: activeThreadId,
      threadKind: activeThreadKind,
      onRevised: function () { return loadMessages(); }
    }).catch(function (e) {
      setComposerStatus(String(e && e.message ? e.message : e), 'err');
    });
  }
  function stripOpenDraftEditorParam() {
    try {
      var u = new URL(window.location.href);
      if (!u.searchParams.has('openDraftEditor')) return;
      u.searchParams.delete('openDraftEditor');
      history.replaceState(null, '', u.pathname + u.search + u.hash);
    } catch (e) { /* ignore */ }
  }
  function maybeOpenDraftEditorFromUrl() {
    if (!pendingOpenDraftEditor || !activeHasDraft) return;
    pendingOpenDraftEditor = false;
    stripOpenDraftEditorParam();
    openDraftEditorModal();
  }
  async function loadDraftSummary(expectedSeq) {
    if (expectedSeq === undefined) expectedSeq = loadSeq;
    var threadAtStart = activeThreadId;
    if (!activeHasDraft) {
      if (expectedSeq === loadSeq) {
        updateDraftContext({ count: 0, unassigned: 0, assigned: 0, nearestDue: '', preview: [] }, false);
      }
      return;
    }
    try {
      var res = await fetch(draftQuery());
      var data = await res.json().catch(function () { return {}; });
      if (expectedSeq !== loadSeq || activeThreadId !== threadAtStart) return;
      if (!res.ok || !data.ok) return;
      updateDraftContext(computeDraftSummary(data), true);
    } catch (e) { /* ignore */ }
  }
  function closeAllThreadMenus() {
    document.querySelectorAll('.chat-thread-item.menu-open').forEach(function (el) {
      el.classList.remove('menu-open');
      var dd = el.querySelector('.chat-thread-dropdown');
      if (dd) dd.hidden = true;
    });
  }
  async function renameSideThread(threadId, currentTitle) {
    var next = window.prompt('重命名会话（1–40 字）', currentTitle || '');
    if (next === null) return;
    next = String(next).trim();
    if (!next) {
      setComposerStatus('名称不能为空', 'err');
      return;
    }
    if (next.length > 40) {
      setComposerStatus('名称最多 40 字', 'err');
      return;
    }
    try {
      var res = await fetch('/api/workbench/conversation/thread', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ threadId: threadId, threadKind: 'side', threadLabel: next })
      });
      var data = await res.json().catch(function () { return {}; });
      if (!res.ok || !data.ok) throw new Error(data.error || ('HTTP ' + res.status));
      setComposerStatus('', 'muted');
      await loadThreads(activeThreadId);
      if (String(activeThreadId) === String(threadId) && data.title) {
        document.getElementById('paneTitle').textContent = data.title;
      }
    } catch (e) {
      setComposerStatus(String(e && e.message ? e.message : e), 'err');
    }
  }
  async function deleteSideThread(threadId, hasDraft) {
    var msg = hasDraft
      ? '确定删除该侧会话？未发布草案将一并丢失，且不可恢复。'
      : '确定删除该侧会话？不可恢复。';
    if (!window.confirm(msg)) return;
    try {
      var res = await fetch(
        '/api/workbench/conversation/thread?thread=side&threadId=' + encodeURIComponent(threadId),
        { method: 'DELETE' }
      );
      var data = await res.json().catch(function () { return {}; });
      if (!res.ok || !data.ok) throw new Error(data.error || ('HTTP ' + res.status));
      setComposerStatus('', 'muted');
      if (String(activeThreadId) === String(threadId)) {
        await switchToMainThread();
      } else {
        await loadThreads(activeThreadId);
      }
    } catch (e) {
      setComposerStatus(String(e && e.message ? e.message : e), 'err');
    }
  }
  async function loadThreads(selectId) {
    var list = document.getElementById('threadList');
    try {
      var res = await fetch('/api/workbench/conversation/threads');
      var data = await res.json().catch(function () { return {}; });
      if (!res.ok || !data.ok) throw new Error(data.error || ('HTTP ' + res.status));
      var threads = data.threads || [];
      if (!threads.length) {
        list.innerHTML = '<li class="muted" style="padding:8px;">暂无会话</li>';
        return;
      }
      var pick = selectId || activeThreadId;
      list.innerHTML = threads.map(function (t) {
        var cls = 'chat-thread-item' + (t.pinned ? ' pinned' : '') + (String(t.threadId) === String(pick) ? ' active' : '');
        var menuBtn = t.kind === 'side'
          ? '<button type="button" class="chat-thread-menu-btn" aria-label="会话操作" data-thread-id="' + escapeHtml(t.threadId) + '" data-thread-title="' + escapeHtml(t.title) + '" data-has-draft="' + (t.hasDraft ? '1' : '0') + '">⋯</button>'
          + '<div class="chat-thread-dropdown" hidden role="menu">'
          + '<button type="button" class="chat-thread-dropdown-item" data-action="rename">重命名</button>'
          + '<button type="button" class="chat-thread-dropdown-item chat-thread-dropdown-item--danger" data-action="delete">删除</button>'
          + '</div>'
          : '';
        return '<li class="' + cls + '" data-thread-id="' + escapeHtml(t.threadId) + '" data-kind="' + escapeHtml(t.kind) + '">'
          + '<div class="chat-thread-title-row"><span class="chat-thread-title">' + (t.pinned ? '📌 ' : '') + escapeHtml(t.title) + '</span>'
          + '<span class="chat-thread-badge">' + escapeHtml(t.badge || '') + '</span></div>'
          + '<div class="chat-thread-preview">' + escapeHtml(t.preview || '') + '</div>'
          + menuBtn + '</li>';
      }).join('');
      list.querySelectorAll('.chat-thread-item').forEach(function (el) {
        el.addEventListener('click', function (ev) {
          if (ev.target.closest('.chat-thread-menu-btn, .chat-thread-dropdown')) return;
          closeAllThreadMenus();
          var tid = el.getAttribute('data-thread-id') || 'main';
          var kind = el.getAttribute('data-kind') || 'main';
          if (tid === activeThreadId && kind === activeThreadKind) return;
          loadSeq += 1;
          var mySeq = loadSeq;
          activeThreadId = tid;
          activeThreadKind = kind;
          history.replaceState(null, '', threadUrl(tid, kind));
          list.querySelectorAll('.chat-thread-item').forEach(function (x) { x.classList.remove('active'); });
          el.classList.add('active');
          resetDraftPanelForThreadSwitch();
          closeThreadDrawer();
          void loadMessages(mySeq);
        });
        var menuBtn = el.querySelector('.chat-thread-menu-btn');
        if (menuBtn) {
          menuBtn.addEventListener('click', function (ev) {
            ev.stopPropagation();
            var wasOpen = el.classList.contains('menu-open');
            closeAllThreadMenus();
            if (!wasOpen) {
              el.classList.add('menu-open');
              var dd = el.querySelector('.chat-thread-dropdown');
              if (dd) dd.hidden = false;
            }
          });
        }
        el.querySelectorAll('.chat-thread-dropdown-item').forEach(function (btn) {
          btn.addEventListener('click', function (ev) {
            ev.stopPropagation();
            closeAllThreadMenus();
            var tid = el.getAttribute('data-thread-id') || '';
            var action = btn.getAttribute('data-action');
            var title = menuBtn ? (menuBtn.getAttribute('data-thread-title') || '') : '';
            var hasDraft = menuBtn && menuBtn.getAttribute('data-has-draft') === '1';
            if (action === 'rename') void renameSideThread(tid, title);
            else if (action === 'delete') void deleteSideThread(tid, hasDraft);
          });
        });
      });
    } catch (e) {
      list.innerHTML = '<li class="chat-sidebar-error">加载会话失败</li>'
        + '<li style="padding:8px;"><button type="button" class="btn btn-ghost btn-sm" id="retryThreadsBtn">重试</button></li>';
      var retry = document.getElementById('retryThreadsBtn');
      if (retry) retry.addEventListener('click', function () { void loadThreads(selectId); });
    }
  }
  async function loadMessages(expectedSeq) {
    if (expectedSeq === undefined) expectedSeq = loadSeq;
    renderSkeleton();
    var stream = document.getElementById('chatStream');
    try {
      var res = await fetch(messagesQuery());
      var data = await res.json().catch(function () { return {}; });
      if (expectedSeq !== loadSeq) return;
      if (!res.ok || !data.ok) throw new Error(data.error || ('HTTP ' + res.status));
      var hasDraft = !!data.hasDraft;
      updatePaneHeader({ title: data.title, badge: data.badge, kind: data.kind, hasDraft: hasDraft });
      applyDraftPanelUi(hasDraft);
      renderMessageRows(data.messages || []);
      await loadDraftSummary(expectedSeq);
      if (expectedSeq !== loadSeq) return;
      maybeOpenDraftEditorFromUrl();
      scrollMessageStreamToBottom();
    } catch (e) {
      if (expectedSeq !== loadSeq) return;
      if (activeThreadKind === 'side' && isThreadNotFoundError(e)) {
        renderThreadLostState();
        setComposerStatus('会话不存在或已过期', 'err');
      } else {
        var box = document.getElementById('msgList');
        if (box) {
          box.innerHTML = '<li class="msg-bubble msg-bubble--error" style="list-style:none;">加载消息失败：'
            + escapeHtml(String(e && e.message ? e.message : e)) + '</li>';
        }
      }
    } finally {
      if (stream) stream.setAttribute('aria-busy', 'false');
    }
  }
  async function sendChatMessage(opts) {
    opts = opts || {};
    if (sendInFlight) return { ok: false, reason: 'busy' };
    var sendBtn = document.getElementById('sendBtn');
    var inputEl = document.getElementById('msgInput');
    var fromComposer = opts.fromComposer !== false && opts.message == null;
    var message = String(opts.message != null ? opts.message : (inputEl ? inputEl.value : '') || '').trim();
    if (!message) {
      if (fromComposer) setComposerStatus('请输入消息内容', 'err');
      return { ok: false, reason: 'empty' };
    }
    sendInFlight = true;
    updateQualityPlanningEnhancer();
    updatePublishBtnUi();
    if (fromComposer) {
      if (sendBtn) sendBtn.disabled = true;
      setComposerStatus('处理中，请稍候…', 'busy');
    }
    var startedAt = Date.now();
    var box = document.getElementById('msgList');
    if (box) {
      var emptyCard = box.querySelector('.chat-welcome, .chat-empty-state');
      if (emptyCard) emptyCard.closest('li').remove();
      var userLi = document.createElement('li');
      userLi.className = 'msg-row msg-row--user';
      userLi.innerHTML = '<div class="msg-bubble msg-bubble--user"><div class="msg-body">' + escapeHtml(message) + '</div></div>';
      box.appendChild(userLi);
    }
    appendPendingBubble(startedAt);
    if (fromComposer && inputEl) inputEl.value = '';
    var prepareAfter = publishFlowState === 'preparing';
    try {
      var res = await fetch('/api/workbench/conversation/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          threadId: activeThreadId,
          threadKind: activeThreadKind,
          message: message
        })
      });
      var data = await res.json().catch(function () { return {}; });
      if (!res.ok || !data.ok) throw new Error(data.error || ('HTTP ' + res.status));
      if (fromComposer) setComposerStatus('', 'muted');
      if (data.threadId) activeThreadId = data.threadId;
      if (data.kind) activeThreadKind = data.kind;
      clearPendingBubble();
      await loadThreads(activeThreadId);
      await loadMessages();
      if (fromComposer) focusComposer();
      if (prepareAfter) {
        publishFlowState = 'awaitConfirmPopup';
        openPublishModal('publishConfirmModalOverlay');
      }
      return { ok: true };
    } catch (e) {
      clearPendingBubble();
      var errLi = document.createElement('li');
      errLi.className = 'msg-row msg-row--assistant';
      errLi.innerHTML = '<div class="msg-bubble msg-bubble--error"><div class="msg-meta">系统</div><div class="msg-body">发送失败：' + escapeHtml(String(e && e.message ? e.message : e)) + '。请重试。</div></div>';
      if (box) box.appendChild(errLi);
      if (fromComposer) setComposerStatus('发送失败，请重试', 'err');
      else setComposerStatus(String(e && e.message ? e.message : e), 'err');
      scrollMessageStreamToBottom();
      if (prepareAfter) resetPublishFlow();
      return { ok: false, reason: 'error' };
    } finally {
      sendInFlight = false;
      syncSendBtnState();
      updateQualityPlanningEnhancer();
      updatePublishBtnUi();
    }
  }
  var qualityPlanningEnhanceBtn = document.getElementById('qualityPlanningEnhanceBtn');
  if (qualityPlanningEnhanceBtn) {
    qualityPlanningEnhanceBtn.addEventListener('click', function () {
      if (qualityPlanningInFlight || sendInFlight || activeThreadKind !== 'side'
        || !activeQualitySourceContext || activeQualitySourceContext.kind !== 'quality_event') return;
      qualityPlanningInFlight = true;
      updateQualityPlanningEnhancer();
      void sendChatMessage({ message: QUALITY_TASK_REPLAN_MSG, fromComposer: false }).finally(function () {
        qualityPlanningInFlight = false;
        updateQualityPlanningEnhancer();
      });
    });
  }
  var sendBtn = document.getElementById('sendBtn');
  if (sendBtn) {
    sendBtn.addEventListener('click', function () { void sendChatMessage({ fromComposer: true }); });
  }
  if (msgInput) {
    msgInput.addEventListener('input', function () {
      msgInput.style.height = 'auto';
      msgInput.style.height = Math.min(msgInput.scrollHeight, 120) + 'px';
      syncSendBtnState();
    });
    msgInput.addEventListener('keydown', function (ev) {
      if (ev.key !== 'Enter' || ev.shiftKey || ev.isComposing) return;
      ev.preventDefault();
      void sendChatMessage({ fromComposer: true });
    });
  }
  syncSendBtnState();
  var openThreadDrawerBtn = document.getElementById('openThreadDrawerBtn');
  if (openThreadDrawerBtn) {
    openThreadDrawerBtn.addEventListener('click', function () {
      var main = document.getElementById('chatMain');
      if (main && main.classList.contains('is-thread-drawer-open')) closeThreadDrawer();
      else openThreadDrawer();
    });
  }
  try { localStorage.removeItem('mgr_chat_sidebar_collapsed'); } catch (eClr) {}
  var chatOverlayBackdrop = document.getElementById('chatOverlayBackdrop');
  if (chatOverlayBackdrop) {
    chatOverlayBackdrop.addEventListener('click', function () {
      closeThreadDrawer();
      closeDraftSheet();
    });
  }
  var openDraftSheetBtn = document.getElementById('openDraftSheetBtn');
  if (openDraftSheetBtn) {
    openDraftSheetBtn.addEventListener('click', function () {
      if (isDraftSheetOpen()) closeDraftSheet();
      else openDraftSheet();
    });
  }
  var closeDraftSheetBtn = document.getElementById('closeDraftSheetBtn');
  if (closeDraftSheetBtn) closeDraftSheetBtn.addEventListener('click', closeDraftSheet);
  var newThreadBtnMobile = document.getElementById('newThreadBtnMobile');
  if (newThreadBtnMobile) {
    newThreadBtnMobile.addEventListener('click', function () {
      var btn = document.getElementById('newThreadBtn');
      if (btn) btn.click();
    });
  }
  var publishDraftBtn = document.getElementById('publishDraftBtnPanel');
  if (publishDraftBtn) {
    publishDraftBtn.addEventListener('click', function () { openPublishPrepareModal(); });
  }
  function bindPublishModalDismiss(overlayId, onDismiss) {
    var overlay = document.getElementById(overlayId);
    if (!overlay) return;
    overlay.querySelectorAll('.wb-modal__close, .btn-secondary[id$="CancelBtn"]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        closePublishModal(overlayId);
        if (onDismiss) onDismiss();
      });
    });
    overlay.addEventListener('click', function (ev) {
      if (ev.target === overlay) {
        closePublishModal(overlayId);
        if (onDismiss) onDismiss();
      }
    });
  }
  bindPublishModalDismiss('publishPrepareModalOverlay', function () { if (publishFlowState === 'idle') resetPublishFlow(); });
  bindPublishModalDismiss('publishConfirmModalOverlay', function () {
    if (publishFlowState === 'awaitConfirmPopup') publishFlowState = 'idle';
    updatePublishBtnUi();
  });
  var publishPrepareContinueBtn = document.getElementById('publishPrepareContinueBtn');
  if (publishPrepareContinueBtn) {
    publishPrepareContinueBtn.addEventListener('click', function () {
      if (!activeHasDraft || sendInFlight) return;
      closePublishModal('publishPrepareModalOverlay');
      publishFlowState = 'preparing';
      updatePublishBtnUi();
      void sendChatMessage({ message: PUBLISH_PREPARE_MSG, fromComposer: false });
    });
  }
  var publishConfirmOkBtn = document.getElementById('publishConfirmOkBtn');
  if (publishConfirmOkBtn) {
    publishConfirmOkBtn.addEventListener('click', function () {
      if (sendInFlight) return;
      closePublishModal('publishConfirmModalOverlay');
      publishFlowState = 'idle';
      void sendChatMessage({ message: PUBLISH_CONFIRM_MSG, fromComposer: false }).then(function () {
        resetPublishFlow();
      });
    });
  }
  var newThreadBtn = document.getElementById('newThreadBtn');
  if (newThreadBtn) {
    newThreadBtn.addEventListener('click', async function () {
      newThreadBtn.disabled = true;
      try {
        var res = await fetch('/api/workbench/conversation/new', { method: 'POST' });
        var data = await res.json().catch(function () { return {}; });
        if (!res.ok || !data.ok) throw new Error(data.error || ('HTTP ' + res.status));
        loadSeq += 1;
        var mySeq = loadSeq;
        activeThreadId = data.threadId;
        activeThreadKind = 'side';
        history.replaceState(null, '', threadUrl(activeThreadId, 'side'));
        resetDraftPanelForThreadSwitch();
        updatePaneHeader({
          title: data.title || '新规划会话',
          badge: data.badge || '侧会话',
          kind: 'side',
          hasDraft: false
        });
        await loadThreads(activeThreadId);
        await loadMessages(mySeq);
        focusComposer();
      } catch (e) {
        setComposerStatus(String(e && e.message ? e.message : e), 'err');
      } finally {
        newThreadBtn.disabled = false;
      }
    });
  }
  var rosterInput = document.getElementById('rosterFileInput');
  var rosterStatusEl = document.getElementById('rosterStatus');
  if (rosterInput) {
    rosterInput.addEventListener('change', async function () {
      var file = rosterInput.files && rosterInput.files[0];
      if (!file) return;
      rosterStatusEl.textContent = '上传中…';
      rosterStatusEl.style.color = '';
      try {
        var fd = new FormData();
        fd.append('threadId', activeThreadId);
        fd.append('threadKind', activeThreadKind);
        fd.append('file', file, file.name);
        var res = await fetch('/api/workbench/manager/upload-roster', { method: 'POST', body: fd });
        var data = await res.json().catch(function () { return {}; });
        if (!res.ok || !data.ok) throw new Error(data.error || ('HTTP ' + res.status));
        rosterStatusEl.textContent =
          '已上传 ' + escapeHtml(data.filename || file.name) +
          '（' + (data.kind || '') + '，' + (data.chars || 0) + ' 字符）';
        rosterStatusEl.style.color = '#0f766e';
      } catch (err) {
        rosterStatusEl.textContent = '上传失败';
        rosterStatusEl.style.color = '#dc2626';
      } finally {
        rosterInput.value = '';
      }
    });
  }
  var draftPanelCollapseBtn = document.getElementById('draftPanelCollapseBtn');
  var draftContextPanel = document.getElementById('draftContextPanel');
  if (draftPanelCollapseBtn && draftContextPanel) {
    draftPanelCollapseBtn.addEventListener('click', function () {
      var collapsed = draftContextPanel.classList.toggle('is-collapsed');
      draftPanelCollapseBtn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
      draftPanelCollapseBtn.textContent = collapsed ? '展开草案面板' : '收起草案面板';
    });
  }
  var editDraftPanelBtn = document.getElementById('editDraftBtnPanel');
  if (editDraftPanelBtn) editDraftPanelBtn.addEventListener('click', openDraftEditorModal);

  var planningContextToggle = document.getElementById('planningContextToggle');
  if (planningContextToggle) {
    planningContextToggle.addEventListener('click', function () {
      var contextCard = document.getElementById('planningContextCard');
      if (!contextCard) return;
      var collapsed = contextCard.classList.toggle('is-collapsed');
      planningContextToggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
      planningContextToggle.setAttribute('aria-label', collapsed ? '展开任务背景' : '收起任务背景');
    });
  }
  var planningPersonSearch = document.getElementById('planningPersonSearch');
  if (planningPersonSearch) {
    planningPersonSearch.addEventListener('input', function () {
      planningPersonChoice = null;
      var confirm = document.getElementById('planningPersonConfirmBtn');
      if (confirm) confirm.disabled = true;
      setPlanningPersonFeedback('', 'muted');
      if (planningPersonSearchTimer) clearTimeout(planningPersonSearchTimer);
      var keyword = String(planningPersonSearch.value || '').trim();
      if (!keyword) {
        planningPersonSearchSeq += 1;
        var emptyResults = document.getElementById('planningPersonResults');
        if (emptyResults) emptyResults.innerHTML = '<div class="planning-person-empty">输入至少 1 个字开始搜索</div>';
        return;
      }
      planningPersonSearchTimer = setTimeout(function () {
        planningPersonSearchSeq += 1;
        void searchPlanningPeople(keyword, planningPersonSearchSeq);
      }, 220);
    });
  }
  var planningPersonConfirmBtn = document.getElementById('planningPersonConfirmBtn');
  if (planningPersonConfirmBtn) {
    planningPersonConfirmBtn.addEventListener('click', function () {
      if (!planningPersonTask || !planningPersonChoice || sendInFlight) return;
      var taskTitle = planningPersonTask.title;
      var taskId = planningPersonTask.taskId;
      var name = planningPersonChoice.name;
      var department = planningPersonChoice.department && planningPersonChoice.department !== '未分配部门'
        ? planningPersonChoice.department + '的'
        : '';
      var message = '请将草案子任务「' + taskTitle + '」（任务编号：' + taskId + '）指派给' + department + name + '。请先核对通讯录，再更新当前草案指派。';
      closePlanningPersonModal();
      void sendChatMessage({ message: message, fromComposer: false });
    });
  }
  var planningPersonModalClose = document.getElementById('planningPersonModalClose');
  if (planningPersonModalClose) planningPersonModalClose.addEventListener('click', closePlanningPersonModal);
  var planningPersonCancelBtn = document.getElementById('planningPersonCancelBtn');
  if (planningPersonCancelBtn) planningPersonCancelBtn.addEventListener('click', closePlanningPersonModal);
  var planningPersonOverlay = document.getElementById('planningPersonModalOverlay');
  if (planningPersonOverlay) {
    planningPersonOverlay.addEventListener('click', function (ev) {
      if (ev.target === planningPersonOverlay) closePlanningPersonModal();
    });
  }

  document.getElementById('logoutBtn').addEventListener('click', async function () {
    var res = await fetch('/api/workbench/logout', { method: 'POST' });
    var data = {};
    try { data = await res.json(); } catch (e) {}
    window.location.href = (data && data.redirectTo) ? data.redirectTo : '/workbench';
  });
  document.addEventListener('click', function (ev) {
    if (!ev.target.closest('.chat-thread-item')) closeAllThreadMenus();
  });
  void loadThreads(activeThreadId).then(function () { return loadMessages(); });
})();
</script>`,
  });
}
