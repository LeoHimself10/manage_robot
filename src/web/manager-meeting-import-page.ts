import { renderWorkbenchPage } from "./workbench-shell";
import { buildWorkbenchViewSwitchClientJs } from "./workbench-view-switch-snippet";

function escapeHtml(v: string): string {
  return v
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function renderManagerMeetingImportPage(params: { userLabel?: string }): string {
  const who = params.userLabel ? escapeHtml(params.userLabel) : "主管";
  const miCss = `
.mi-stepper { display:flex; gap:8px; margin-bottom:16px; flex-wrap:wrap; }
.mi-step { padding:6px 12px; border-radius:999px; border:1px solid #e2e8f0; font-size:13px; color:#64748b; }
.mi-step.active { background:#eff6ff; border-color:#93c5fd; color:#1d4ed8; font-weight:600; }
.mi-panel[hidden] { display:none !important; }
.mi-table-wrap { overflow:auto; max-height:52vh; border:1px solid #e2e8f0; border-radius:8px; }
.mi-table { width:100%; border-collapse:collapse; font-size:13px; }
.mi-table th, .mi-table td { border-bottom:1px solid #e2e8f0; padding:8px; vertical-align:top; text-align:left; }
.mi-table th { position:sticky; top:0; background:#f8fafc; z-index:1; }
.mi-tag { display:inline-block; padding:2px 8px; border-radius:999px; font-size:11px; }
.mi-tag-dup { background:#fee2e2; color:#991b1b; }
.mi-tag-contained { background:#fef3c7; color:#92400e; }
.mi-tag-super { background:#ffedd5; color:#9a3412; }
.mi-tag-similar { background:#dbeafe; color:#1e40af; }
.mi-tag-none { background:#f1f5f9; color:#475569; }
.mi-edited { font-size:11px; color:#7c3aed; }
.mi-stats { font-size:13px; color:#475569; margin:12px 0; }
.mi-actions { display:flex; gap:8px; flex-wrap:wrap; margin-top:12px; }
textarea.mi-text { width:100%; min-height:200px; font-family:inherit; }
`;

  return renderWorkbenchPage({
    role: "manager",
    activeNav: "mgr-meeting-import",
    title: "会议待办入库",
    pageTitle: "会议入库 · 主管工作台",
    description: `粘贴会议纪要或 Action Items，AI 建议项目与父任务归属，确认后批量发布。${who}`,
    userLabel: params.userLabel,
    portfolioEnabled: true,
    extraCss: miCss,
    mainHtml: `
  <div class="mi-stepper" aria-label="步骤">
    <span class="mi-step active" data-step-label="1">1. 输入</span>
    <span class="mi-step" data-step-label="2">2. 项目</span>
    <span class="mi-step" data-step-label="3">3. 预览</span>
    <span class="mi-step" data-step-label="4">4. 结果</span>
  </div>

  <div class="card mi-panel" id="step1Panel">
    <div class="form-stack">
      <label>会议标题 <input id="meetingTitle" type="text" placeholder="如：5月28日项目周会" /></label>
      <label>会议日期 <input id="meetingDate" type="date" /></label>
      <label>文档链接（可选） <input id="docUrl" type="url" placeholder="https://..." /></label>
      <label>粘贴会议正文 / Action Items
        <textarea id="pastedText" class="mi-text" placeholder="粘贴含 Action Items / 待办 章节的会议内容…"></textarea>
      </label>
      <p class="feedback muted" id="parseFeedback"></p>
      <div class="mi-actions">
        <button type="button" class="btn btn-primary" id="parseBtn">提取待办</button>
      </div>
    </div>
  </div>

  <div class="card mi-panel" id="step2Panel" hidden>
    <p id="parseSummary" class="muted"></p>
    <div class="form-stack">
      <label>归属大项目
        <select id="projectSelect"></select>
      </label>
      <p id="projectReason" class="muted"></p>
      <div class="mi-actions">
        <button type="button" class="btn btn-ghost" id="backTo1Btn">上一步</button>
        <button type="button" class="btn btn-primary" id="analyzeBtn">生成预览</button>
      </div>
    </div>
  </div>

  <div class="card mi-panel" id="step3Panel" hidden>
    <p class="mi-stats" id="previewStats"></p>
    <div class="mi-table-wrap">
      <table class="mi-table" id="previewTable">
        <thead>
          <tr>
            <th>入库</th>
            <th>待办</th>
            <th>关系</th>
            <th>父任务</th>
            <th>负责人</th>
            <th>截止</th>
          </tr>
        </thead>
        <tbody id="previewBody"></tbody>
      </table>
    </div>
    <div class="mi-actions">
      <button type="button" class="btn btn-ghost" id="backTo2Btn">上一步</button>
      <button type="button" class="btn btn-primary" id="commitBtn">确认入库</button>
    </div>
    <p class="feedback muted" id="commitFeedback"></p>
  </div>

  <div class="card mi-panel" id="step4Panel" hidden>
    <div id="resultBody"></div>
    <div class="mi-actions">
      <a class="btn btn-primary" id="tasksLink" href="/workbench/manager/tasks">查看历史任务</a>
      <button type="button" class="btn btn-ghost" id="restartBtn">再导入一场</button>
    </div>
  </div>`,
    scriptHtml: `<script>
${buildWorkbenchViewSwitchClientJs()}
(function () {
  var state = {
    step: 1,
    batchId: "",
    items: [],
    rows: [],
    projectId: "",
    projectName: "",
    projects: [],
    existingTasks: [],
  };

  function setStep(n) {
    state.step = n;
    document.querySelectorAll(".mi-step").forEach(function (el) {
      el.classList.toggle("active", el.getAttribute("data-step-label") === String(n));
    });
    ["step1Panel", "step2Panel", "step3Panel", "step4Panel"].forEach(function (id, i) {
      document.getElementById(id).hidden = i + 1 !== n;
    });
  }

  function relationTag(kind) {
    var labels = { duplicate: "重复", contained: "已包含", superset: "待扩展", similar: "相似", none: "无" };
    var cls = { duplicate: "mi-tag-dup", contained: "mi-tag-contained", superset: "mi-tag-super", similar: "mi-tag-similar", none: "mi-tag-none" };
    return '<span class="mi-tag ' + (cls[kind] || "mi-tag-none") + '">' + (labels[kind] || kind) + "</span>";
  }

  async function loadProjects() {
    var res = await fetch("/api/workbench/manager/projects");
    var data = await res.json();
    if (!data.ok) throw new Error(data.error || "load projects failed");
    state.projects = data.projects || [];
    var sel = document.getElementById("projectSelect");
    sel.innerHTML = state.projects.map(function (p) {
      return '<option value="' + p.projectId + '">' + p.name + "</option>";
    }).join("");
  }

  async function loadTasksForProject(projectId) {
    var res = await fetch("/api/workbench/manager/tasks?projectId=" + encodeURIComponent(projectId));
    var data = await res.json();
    state.existingTasks = data.ok ? (data.tasks || []) : [];
  }

  document.getElementById("parseBtn").addEventListener("click", async function () {
    var fb = document.getElementById("parseFeedback");
    fb.textContent = "提取中…";
    try {
      var res = await fetch("/api/workbench/manager/meeting-import/parse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pastedText: document.getElementById("pastedText").value,
          docUrl: document.getElementById("docUrl").value,
          meetingTitle: document.getElementById("meetingTitle").value,
          meetingDate: document.getElementById("meetingDate").value,
        }),
      });
      var data = await res.json();
      if (!data.ok) throw new Error(data.error || "parse failed");
      state.batchId = data.batchId;
      state.items = data.items || [];
      fb.textContent = (data.warnings && data.warnings.length)
        ? "已提取 " + state.items.length + " 条；提示：" + data.warnings.join("；")
        : "已提取 " + state.items.length + " 条待办";
      if (!state.items.length) return;
      await loadProjects();
      var sug = data.projectSuggestion || {};
      if (sug.projectId) {
        document.getElementById("projectSelect").value = sug.projectId;
      }
      document.getElementById("projectReason").textContent = sug.reason || "";
      document.getElementById("parseSummary").textContent =
        "共 " + state.items.length + " 条待办，请确认归属项目后继续。";
      setStep(2);
    } catch (err) {
      fb.textContent = err.message || String(err);
    }
  });

  document.getElementById("analyzeBtn").addEventListener("click", async function () {
    var sel = document.getElementById("projectSelect");
    state.projectId = sel.value;
    state.projectName = sel.options[sel.selectedIndex]?.text || "";
    if (!state.projectId) { alert("请选择项目"); return; }
    await loadTasksForProject(state.projectId);
    var res = await fetch("/api/workbench/manager/meeting-import/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        batchId: state.batchId,
        projectId: state.projectId,
        projectName: state.projectName,
        items: state.items,
        meetingTitle: document.getElementById("meetingTitle").value,
      }),
    });
    var data = await res.json();
    if (!data.ok) { alert(data.error || "analyze failed"); return; }
    state.rows = data.rows || [];
    renderPreview();
    setStep(3);
  });

  function renderPreview() {
    var body = document.getElementById("previewBody");
    body.innerHTML = state.rows.map(function (row, idx) {
      var parentOpts = state.existingTasks.map(function (t) {
        var selected = row.parent && row.parent.kind === "existing" && row.parent.taskNo === t.taskNo;
        return '<option value="' + t.taskNo + '" data-plan="' + t.planId + '"' + (selected ? " selected" : "") + ">" + t.title + " (#" + t.taskNo + ")</option>";
      }).join("");
      var newTitle = (row.parent && row.parent.suggestedTitle) || "";
      return "<tr data-idx=\"" + idx + "\">" +
        '<td><input type="checkbox" class="row-selected"' + (row.selected ? " checked" : "") + " /></td>" +
        "<td><input class=\"row-title\" value=\"" + escapeAttr(row.title) + "\" />" +
        "<div class=\"muted\" style=\"font-size:11px\">" + escapeAttr(row.excerpt || "") + "</div></td>" +
        "<td>" + relationTag(row.relationKind) + "<div class=\"muted\">" + escapeAttr(row.relationReason || "") + "</div></td>" +
        "<td><select class=\"row-parent-mode\"><option value=\"new\"" + (row.parent?.kind !== "existing" ? " selected" : "") + ">新建</option><option value=\"existing\"" + (row.parent?.kind === "existing" ? " selected" : "") + ">已有</option></select>" +
        "<select class=\"row-parent-existing\"" + (row.parent?.kind === "existing" ? "" : " hidden") + ">" + parentOpts + "</select>" +
        '<input class="row-parent-new" value="' + escapeAttr(newTitle) + '"' + (row.parent?.kind === "existing" ? " hidden" : "") + " /></td>" +
        '<td><input class="row-assignee-id" value="' + escapeAttr(row.assigneeUserId || "") + '" placeholder="userId" />' +
        '<div class="muted">' + escapeAttr(row.assigneeDisplayName || row.assigneeNameRaw || "") + "</div></td>" +
        '<td><input class="row-due" type="date" value="' + escapeAttr((row.dueAt || "").slice(0, 10)) + '" /></td>' +
        "</tr>";
    }).join("");

    body.querySelectorAll(".row-parent-mode").forEach(function (el) {
      el.addEventListener("change", function () {
        var tr = el.closest("tr");
        var isExisting = el.value === "existing";
        tr.querySelector(".row-parent-existing").hidden = !isExisting;
        tr.querySelector(".row-parent-new").hidden = isExisting;
      });
    });

    var newCount = state.rows.filter(function (r) { return r.parent?.kind !== "existing"; }).length;
    var appendCount = state.rows.filter(function (r) { return r.parent?.kind === "existing"; }).length;
    document.getElementById("previewStats").textContent =
      "将新建约 " + newCount + " 组大任务、追加 " + appendCount + " 条到已有任务（可在表格中调整）";
  }

  function escapeAttr(s) {
    return String(s || "").replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
  }

  function collectRowsFromTable() {
    var out = [];
    document.querySelectorAll("#previewBody tr").forEach(function (tr) {
      var idx = Number(tr.getAttribute("data-idx"));
      var base = state.rows[idx];
      if (!base) return;
      var mode = tr.querySelector(".row-parent-mode").value;
      var parent = { kind: mode === "existing" ? "existing" : "new" };
      if (mode === "existing") {
        var sel = tr.querySelector(".row-parent-existing");
        var opt = sel.options[sel.selectedIndex];
        parent.taskNo = sel.value;
        parent.planId = opt?.getAttribute("data-plan") || "";
        parent.existingTaskTitle = opt?.text || "";
      } else {
        parent.suggestedTitle = tr.querySelector(".row-parent-new").value;
        parent.themeKey = base.parent?.themeKey || "theme-" + idx;
      }
      out.push({
        itemId: base.itemId,
        selected: tr.querySelector(".row-selected").checked,
        title: tr.querySelector(".row-title").value,
        excerpt: base.excerpt,
        relationKind: base.relationKind,
        relationReason: base.relationReason,
        projectId: state.projectId,
        projectName: state.projectName,
        parent: parent,
        assigneeUserId: tr.querySelector(".row-assignee-id").value,
        assigneeDisplayName: base.assigneeDisplayName,
        dueAt: tr.querySelector(".row-due").value || undefined,
        objective: base.objective,
        deliverables: base.deliverables,
        completionCriteria: base.completionCriteria,
        manuallyEdited: true,
      });
    });
    return out;
  }

  document.getElementById("commitBtn").addEventListener("click", async function () {
    var fb = document.getElementById("commitFeedback");
    fb.textContent = "提交中…";
    var previewRows = collectRowsFromTable();
    var rows = previewRows.map(function (r) {
      return {
        itemId: r.itemId,
        selected: r.selected,
        title: r.title,
        excerpt: r.excerpt,
        projectId: r.projectId,
        parentKind: r.parent.kind,
        planId: r.parent.planId,
        taskNo: r.parent.taskNo,
        newParentTitle: r.parent.suggestedTitle,
        themeKey: r.parent.themeKey,
        assigneeUserId: r.assigneeUserId,
        dueAt: r.dueAt,
        objective: r.objective,
        deliverables: r.deliverables,
        completionCriteria: r.completionCriteria,
        manuallyEdited: r.manuallyEdited,
      };
    });
    try {
      var res = await fetch("/api/workbench/manager/meeting-import/commit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          batchId: state.batchId,
          projectId: state.projectId,
          projectName: state.projectName,
          meetingTitle: document.getElementById("meetingTitle").value,
          rows: rows,
        }),
      });
      var data = await res.json();
      if (!data.ok) throw new Error(data.error || "commit failed");
      var r = data.result || {};
      document.getElementById("resultBody").innerHTML =
        "<p>新建大任务 " + (r.createdTasks?.length || 0) + " 个，追加子任务 " + (r.appendedSubtasks?.length || 0) + " 条，跳过 " + (r.skipped?.length || 0) + " 条。</p>" +
        (r.errors?.length ? "<p class=\"feedback\">部分失败：" + r.errors.map(function (e) { return e.itemId + ": " + e.message; }).join("；") + "</p>" : "");
      document.getElementById("tasksLink").href =
        "/workbench/manager/tasks?projectId=" + encodeURIComponent(state.projectId);
      setStep(4);
    } catch (err) {
      fb.textContent = err.message || String(err);
    }
  });

  document.getElementById("backTo1Btn").addEventListener("click", function () { setStep(1); });
  document.getElementById("backTo2Btn").addEventListener("click", function () { setStep(2); });
  document.getElementById("restartBtn").addEventListener("click", function () { location.reload(); });
  document.getElementById("logoutBtn").addEventListener("click", function () {
    fetch("/api/workbench/logout", { method: "POST" }).finally(function () {
      location.href = "/workbench/login";
    });
  });
  wbBindViewSwitchLink('navMyTasks', 'employee', '/workbench/employee?view=new');
})();
</script>`,
  });
}
