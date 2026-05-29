/** Inline client JS for unified subtask execution fields (manager + employee detail). */

export function buildSubtaskPlanningFieldsClientJs(): string {
  return `
  function fieldDash(v) {
    if (v == null) return '—';
    if (Array.isArray(v)) {
      var joined = v.map(function (x) { return String(x || '').trim(); }).filter(Boolean).join('；');
      return joined ? esc(joined) : '—';
    }
    var s = String(v).trim();
    return s ? esc(s) : '—';
  }
  function subtaskCoreDtDds(s, subs) {
    var parts = [];
    parts.push('<dt>目标</dt><dd>' + fieldDash(s.objective) + '</dd>');
    parts.push('<dt>交付物</dt><dd>' + fieldDash(s.deliverables) + '</dd>');
    parts.push('<dt>完成标准</dt><dd>' + fieldDash(s.completionCriteria) + '</dd>');
    parts.push('<dt>截止</dt><dd>' + (s.dueAt ? esc(String(s.dueAt).slice(0, 10)) : '—') + '</dd>');
    parts.push('<dt>执行动作</dt><dd>' + fieldDash(s.actions) + '</dd>');
    parts.push('<dt>前置依赖</dt><dd>' + (s.dependsOn && s.dependsOn.length ? esc(depTitles(subs, s.dependsOn)) : '—') + '</dd>');
    return parts.join('');
  }
  function subtaskPlanningBlock(s, subs, opts) {
    opts = opts || {};
    if (opts.moreOnly) return '';
    var coreHtml = subtaskCoreDtDds(s, subs);
    return (
      '<div class="subtask-planning-block">' +
      '<p class="muted subtask-field-hint" style="margin:0 0 8px;font-size:12px;">— 表示发布时未填写</p>' +
      '<h4 class="subs-section-h" style="margin:0 0 6px;font-size:13px;">执行要点</h4>' +
      '<dl class="subtask-detail-dl">' + coreHtml + '</dl>' +
      '</div>'
    );
  }
  function subtaskCardCoreLines(s, subs) {
    var due = s.dueAt ? esc(String(s.dueAt).slice(0, 10)) : '—';
    var assignee = fieldDash(s.assigneeDisplayName || s.assigneeName || s.assigneeUserId || '');
    return '<div class="task-card-summary">'
      + '<p class="meta"><span class="task-card-lbl">负责人</span> ' + assignee + ' · <span class="task-card-lbl">截止</span> ' + due + '</p>'
      + '<p class="meta task-card-desc"><span class="task-card-lbl">目标</span> ' + fieldDash(clipStr(s.objective, 120)) + '</p>'
      + '</div>'
      + subtaskCardPlanningDetails(s, subs);
  }
  function subtaskCardPlanningDetails(s, subs) {
    var coreHtml = subtaskCoreDtDds(s, subs);
    return (
      '<details class="task-card-planning">' +
      '<summary>查看完整规划要点</summary>' +
      '<div class="subtask-planning-block">' +
      '<dl class="subtask-detail-dl">' + coreHtml + '</dl>' +
      '</div></details>'
    );
  }`.trim();
}
