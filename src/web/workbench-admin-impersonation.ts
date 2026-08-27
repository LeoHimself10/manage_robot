import { createPeopleDirectoryStore } from "../infra/people-directory-store";
import { resolveWorkbenchCapabilities } from "../security/workbench-capabilities";
import { isWorkbenchProjectPortfolioEnabled } from "../security/workbench-project-portfolio";
import { resolveQualityCapabilities } from "../security/quality-capabilities";
import {
  getAdminTestActor,
  isAdminTestSystemEnabled,
  listAdminTestActors,
} from "../testing/admin-test-actors";
import type { WorkbenchSession } from "./assignment-workbench-session-types";

export type WorkbenchImpersonationTargetKind =
  | "manager"
  | "project_manager"
  | "employee"
  | "quality_specialist";

export interface WorkbenchImpersonationTarget {
  userId: string;
  name: string;
  departmentNames: string[];
  position: string;
  kind: WorkbenchImpersonationTargetKind;
  kindLabel: string;
  displayLabel: string;
}

const KIND_LABELS: Record<WorkbenchImpersonationTargetKind, string> = {
  manager: "普通主管",
  project_manager: "项目主管",
  employee: "普通员工",
  quality_specialist: "质量员工",
};

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function classifyWorkbenchImpersonationTarget(
  userId: string,
): WorkbenchImpersonationTargetKind | undefined {
  const testActor = getAdminTestActor(userId);
  if (testActor) return testActor.impersonationKind;
  const caps = resolveWorkbenchCapabilities(userId);
  if (caps.primaryRole === "admin") {
    return caps.canManage ? "project_manager" : undefined;
  }
  if (caps.primaryRole === "manager") {
    return isWorkbenchProjectPortfolioEnabled(userId)
      || resolveQualityCapabilities(userId).isProjectManager
      ? "project_manager"
      : "manager";
  }
  if (caps.primaryRole === "employee") {
    return resolveQualityCapabilities(userId).hasQualityManagement
      ? "quality_specialist"
      : "employee";
  }
  return undefined;
}

export function listWorkbenchImpersonationTargets(params?: {
  kind?: WorkbenchImpersonationTargetKind;
  query?: string;
  limit?: number;
}): WorkbenchImpersonationTarget[] {
  if (isAdminTestSystemEnabled()) {
    const limit = Math.max(1, Math.min(Number(params?.limit ?? 50) || 50, 100));
    return listAdminTestActors(params?.query).slice(0, limit).map((actor) => ({
      userId: actor.userId,
      name: actor.displayName,
      departmentNames: [actor.departmentName],
      position: actor.position,
      kind: actor.impersonationKind,
      kindLabel: actor.kindLabel,
      displayLabel: `${actor.displayName} · ${actor.departmentName} · ${actor.kindLabel}`,
    }));
  }
  const people = createPeopleDirectoryStore();
  try {
    const query = String(params?.query ?? "").trim().toLocaleLowerCase("zh-CN");
    const limit = Math.max(1, Math.min(Number(params?.limit ?? 50) || 50, 100));
    const items: WorkbenchImpersonationTarget[] = [];
    for (const contact of people.listContacts()) {
      if (!contact.active) continue;
      const kind = classifyWorkbenchImpersonationTarget(contact.userId);
      if (!kind || (params?.kind && kind !== params.kind)) continue;
      const departmentNames = contact.departmentNames.map((item) => item.trim()).filter(Boolean);
      const searchText = [contact.userId, contact.name, contact.position, ...departmentNames]
        .join(" ")
        .toLocaleLowerCase("zh-CN");
      if (query && !searchText.includes(query)) continue;
      const kindLabel = KIND_LABELS[kind];
      const department = departmentNames.join("、") || "未配置部门";
      items.push({
        userId: contact.userId,
        name: contact.name || contact.userId,
        departmentNames,
        position: contact.position ?? "",
        kind,
        kindLabel,
        displayLabel: `${contact.name || contact.userId} · ${department} · ${kindLabel}`,
      });
    }
    return items
      .sort((left, right) => left.kindLabel.localeCompare(right.kindLabel, "zh-CN")
        || left.name.localeCompare(right.name, "zh-CN")
        || left.userId.localeCompare(right.userId))
      .slice(0, limit);
  } finally {
    people.close();
  }
}

export function resolveWorkbenchImpersonationTarget(
  userId: string,
): WorkbenchImpersonationTarget | undefined {
  const normalized = userId.trim();
  if (!normalized) return undefined;
  const testActor = getAdminTestActor(normalized);
  if (testActor) {
    return {
      userId: testActor.userId,
      name: testActor.displayName,
      departmentNames: [testActor.departmentName],
      position: testActor.position,
      kind: testActor.impersonationKind,
      kindLabel: testActor.kindLabel,
      displayLabel: `${testActor.displayName} · ${testActor.departmentName} · ${testActor.kindLabel}`,
    };
  }
  return listWorkbenchImpersonationTargets({ limit: 100 })
    .find((item) => item.userId === normalized)
    ?? (() => {
      const people = createPeopleDirectoryStore();
      try {
        const contact = people.getContact(normalized);
        if (!contact?.active) return undefined;
        const kind = classifyWorkbenchImpersonationTarget(normalized);
        if (!kind) return undefined;
        const departmentNames = contact.departmentNames.map((item) => item.trim()).filter(Boolean);
        const kindLabel = KIND_LABELS[kind];
        return {
          userId: normalized,
          name: contact.name || normalized,
          departmentNames,
          position: contact.position ?? "",
          kind,
          kindLabel,
          displayLabel: `${contact.name || normalized} · ${departmentNames.join("、") || "未配置部门"} · ${kindLabel}`,
        };
      } finally {
        people.close();
      }
    })();
}

function adminSwitchDialogHtml(): string {
  if (isAdminTestSystemEnabled()) {
    return `<dialog class="wb-impersonation-dialog" id="wbImpersonationDialog" aria-labelledby="wbImpersonationTitle">
  <form method="dialog" class="wb-impersonation-card">
    <div class="wb-impersonation-head"><div><span>ADMIN TEST SYSTEM</span><h2 id="wbImpersonationTitle">切换测试身份</h2><p>仅限管理员。系统内数据和状态正常流转，不发送真实钉钉消息。</p></div><button class="btn btn-ghost btn-sm" value="cancel" aria-label="关闭">×</button></div>
    <div class="wb-impersonation-fields wb-impersonation-fields-test">
      <label>搜索测试身份<input id="wbImpersonationQuery" autocomplete="off" placeholder="输入姓名或测试角色" /></label>
    </div>
    <div class="wb-impersonation-results" id="wbImpersonationResults" role="listbox"><p>正在读取测试身份…</p></div>
    <div class="wb-impersonation-feedback" id="wbImpersonationFeedback" role="status"></div>
  </form>
</dialog>`;
  }
  return `<dialog class="wb-impersonation-dialog" id="wbImpersonationDialog" aria-labelledby="wbImpersonationTitle">
  <form method="dialog" class="wb-impersonation-card">
    <div class="wb-impersonation-head"><div><span>ADMIN DELEGATION</span><h2 id="wbImpersonationTitle">切换到成员工作台</h2><p>切换后页面、数据范围和操作能力与该成员本人登录完全一致。</p></div><button class="btn btn-ghost btn-sm" value="cancel" aria-label="关闭">×</button></div>
    <div class="wb-impersonation-fields">
      <label>身份类型<select id="wbImpersonationKind"><option value="project_manager">项目主管</option><option value="manager">普通主管</option><option value="quality_specialist">质量员工</option><option value="employee">普通员工</option></select></label>
      <label>搜索具体人员<input id="wbImpersonationQuery" autocomplete="off" placeholder="输入姓名、部门或职位" /></label>
    </div>
    <div class="wb-impersonation-results" id="wbImpersonationResults" role="listbox"><p>正在读取可切换人员…</p></div>
    <div class="wb-impersonation-feedback" id="wbImpersonationFeedback" role="status"></div>
  </form>
</dialog>`;
}

function adminSwitchClientJs(): string {
  return `<script>(function(){
  var open=document.getElementById('wbImpersonationOpen'),dialog=document.getElementById('wbImpersonationDialog');
  if(!open||!dialog)return;
  var kind=document.getElementById('wbImpersonationKind'),query=document.getElementById('wbImpersonationQuery'),results=document.getElementById('wbImpersonationResults'),feedback=document.getElementById('wbImpersonationFeedback'),timer=0;
  function esc(v){return String(v||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
  async function load(){feedback.textContent='';results.innerHTML='<p>正在读取可切换人员…</p>';var params=[];if(kind)params.push('kind='+encodeURIComponent(kind.value));params.push('query='+encodeURIComponent(query.value||''));var url='/api/workbench/admin/impersonation-targets?'+params.join('&');try{var res=await fetch(url,{cache:'no-store'}),data=await res.json();if(!res.ok||!data.ok)throw new Error(data.error||('HTTP '+res.status));var items=data.targets||[];results.innerHTML=items.length?items.map(function(item){return '<button type="button" class="wb-impersonation-person" data-user-id="'+esc(item.userId)+'"><strong>'+esc(item.name)+'</strong><span>'+esc((item.departmentNames||[]).join('、')||'未配置部门')+' · '+esc(item.kindLabel)+'</span><small>'+esc(item.position||item.userId)+'</small></button>';}).join(''):'<p>没有匹配人员</p>';results.querySelectorAll('[data-user-id]').forEach(function(button){button.addEventListener('click',function(){void enter(button.getAttribute('data-user-id'));});});}catch(error){results.innerHTML='';feedback.textContent=error.message||'人员读取失败';}}
  async function enter(userId){feedback.textContent='正在切换并进入该成员工作台…';results.querySelectorAll('button').forEach(function(button){button.disabled=true;});try{var res=await fetch('/api/workbench/admin/impersonation',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({targetUserId:userId})}),data=await res.json();if(!res.ok||!data.ok)throw new Error(data.error||('HTTP '+res.status));window.location.href=data.redirectTo;}catch(error){feedback.textContent=error.message||'切换失败';results.querySelectorAll('button').forEach(function(button){button.disabled=false;});}}
  open.addEventListener('click',function(){dialog.showModal();void load();});if(kind)kind.addEventListener('change',function(){void load();});query.addEventListener('input',function(){clearTimeout(timer);timer=setTimeout(load,220);});
})();</script>`;
}

function exitClientJs(): string {
  return `<script>(function(){var button=document.getElementById('wbImpersonationExit');if(!button)return;button.addEventListener('click',async function(){button.disabled=true;try{var res=await fetch('/api/workbench/admin/impersonation/exit',{method:'POST'}),data=await res.json();window.location.href=res.ok&&data.redirectTo?data.redirectTo:'/workbench/admin/ops';}catch(error){button.disabled=false;}});})();</script>`;
}

const IMPERSONATION_CSS = `<style>
.wb-impersonation-open{border-color:#d6a44d!important;background:#fff9ec!important;color:#744c06!important}.wb-impersonation-chip{display:flex;align-items:center;gap:8px;min-width:0;padding:5px 7px 5px 10px;border:1px solid #e1b75e;border-radius:9px;background:#fff8e7;color:#6d4806}.wb-impersonation-chip span{font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.wb-impersonation-chip strong{font-size:12px}.wb-impersonation-dialog{width:min(620px,calc(100vw - 28px));padding:0;border:0;border-radius:16px;box-shadow:0 24px 70px rgba(15,23,42,.28)}.wb-impersonation-dialog::backdrop{background:rgba(15,23,42,.46);backdrop-filter:blur(2px)}.wb-impersonation-card{padding:0}.wb-impersonation-head{display:flex;justify-content:space-between;gap:18px;padding:22px 24px 18px;border-bottom:1px solid #e6e8ec}.wb-impersonation-head span{font-size:11px;letter-spacing:.12em;color:#9a670b;font-weight:700}.wb-impersonation-head h2{margin:5px 0 4px;font-size:21px;color:#172033}.wb-impersonation-head p{margin:0;color:#667085;font-size:13px}.wb-impersonation-fields{display:grid;grid-template-columns:180px 1fr;gap:12px;padding:18px 24px 12px}.wb-impersonation-fields-test{grid-template-columns:1fr}.wb-impersonation-fields label{display:grid;gap:6px;font-size:12px;font-weight:650;color:#344054}.wb-impersonation-fields select,.wb-impersonation-fields input{height:42px;border:1px solid #cfd5df;border-radius:9px;padding:0 12px;background:#fff;color:#172033}.wb-impersonation-results{display:grid;gap:8px;max-height:360px;overflow:auto;padding:4px 24px 18px}.wb-impersonation-results>p{margin:10px 0;color:#667085;font-size:13px}.wb-impersonation-person{display:grid;grid-template-columns:1fr auto;gap:2px 12px;text-align:left;padding:12px 14px;border:1px solid #dde2ea;border-radius:10px;background:#fff;cursor:pointer}.wb-impersonation-person:hover{border-color:#c28a1d;background:#fffbf2}.wb-impersonation-person strong{font-size:14px;color:#172033}.wb-impersonation-person span{font-size:12px;color:#58677d}.wb-impersonation-person small{grid-column:2;grid-row:1 / span 2;align-self:center;color:#8a94a6}.wb-impersonation-feedback{min-height:20px;padding:0 24px 18px;color:#b42318;font-size:13px}@media(max-width:700px){.wb-impersonation-chip span{display:none}.wb-impersonation-fields{grid-template-columns:1fr}.wb-impersonation-person{grid-template-columns:1fr}.wb-impersonation-person small{grid-column:1;grid-row:auto}.wb-impersonation-open .wb-role-switch-txt{display:none}}
</style>`;

export function decorateWorkbenchHtmlForAdminImpersonation(
  html: string,
  session: Pick<WorkbenchSession, "userId" | "role" | "dingUser" | "impersonation">,
): string {
  const impersonation = session.impersonation;
  const actorUserId = impersonation?.actorUserId ?? session.userId;
  if (!resolveWorkbenchCapabilities(actorUserId).canAccessAdmin) return html;
  let decorated = html.replace("</head>", `${IMPERSONATION_CSS}</head>`);
  if (impersonation) {
    const target = escapeHtml(impersonation.targetName || session.dingUser?.name || session.userId);
    const kind = escapeHtml(KIND_LABELS[impersonation.targetKind]);
    const chip = `<div class="wb-impersonation-chip" role="status"><span>管理员代办</span><strong>${target} · ${kind}</strong><button type="button" class="btn btn-ghost btn-sm" id="wbImpersonationExit">退出代办</button></div>`;
    decorated = decorated.replace('<div class="wb-appbar-actions">', `<div class="wb-appbar-actions">${chip}`);
    return decorated.replace("</body>", `${exitClientJs()}</body>`);
  }
  const button = `<button type="button" class="btn btn-sm wb-impersonation-open" id="wbImpersonationOpen"><span aria-hidden="true">⇄</span><span class="wb-role-switch-txt">切换工作台</span></button>`;
  decorated = decorated.replace('<div class="wb-appbar-actions">', `<div class="wb-appbar-actions">${button}`);
  return decorated.replace("</body>", `${adminSwitchDialogHtml()}${adminSwitchClientJs()}</body>`);
}
