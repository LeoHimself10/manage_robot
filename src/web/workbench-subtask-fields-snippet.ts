/** Inline client JS for unified 6+7 subtask planning fields (manager + employee detail). */

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
  function subtaskMoreDtDds(s, subs) {
    var parts = [];
    parts.push('<dt>反馈频率</dt><dd>' + fieldDash(s.feedbackFrequency) + '</dd>');
    parts.push('<dt>输入材料</dt><dd>' + fieldDash(s.inputMaterials) + '</dd>');
    parts.push('<dt>协作人</dt><dd>' + fieldDash(s.collaborators) + '</dd>');
    parts.push('<dt>范围内</dt><dd>' + fieldDash(s.inScope) + '</dd>');
    parts.push('<dt>范围外</dt><dd>' + fieldDash(s.outOfScope) + '</dd>');
    parts.push('<dt>检查点</dt><dd>' + fieldDash(s.checkpoints) + '</dd>');
    parts.push('<dt>风险与待澄清</dt><dd>' + fieldDash(s.risks) + '</dd>');
    return parts.join('');
  }
  function subtaskPlanningBlock(s, subs, opts) {
    opts = opts || {};
    var moreOnly = !!opts.moreOnly;
    var coreHtml = subtaskCoreDtDds(s, subs);
    var moreHtml = subtaskMoreDtDds(s, subs);
    if (moreOnly) {
      return '<details class="subtask-more-details"><summary>更多规划（7 项）</summary><dl class="subtask-detail-dl">' + moreHtml + '</dl></details>';
    }
    return (
      '<div class="subtask-planning-block">' +
      '<p class="muted subtask-field-hint" style="margin:0 0 8px;font-size:12px;">— 表示发布时未填写</p>' +
      '<h4 class="subs-section-h" style="margin:0 0 6px;font-size:13px;">执行要点</h4>' +
      '<dl class="subtask-detail-dl">' + coreHtml + '</dl>' +
      '<details class="subtask-more-details"><summary>更多规划（7 项）</summary><dl class="subtask-detail-dl">' + moreHtml + '</dl></details>' +
      '</div>'
    );
  }
  function subtaskCardCoreLines(s, subs) {
    var lines = [];
    lines.push('<p class="meta task-card-field"><span class="task-card-lbl">目标</span> ' + fieldDash(clipStr(s.objective, 100)) + '</p>');
    lines.push('<p class="meta task-card-field"><span class="task-card-lbl">交付</span> ' + fieldDash(clipStr(s.deliverables, 100)) + '</p>');
    lines.push('<p class="meta task-card-field"><span class="task-card-lbl">完成标准</span> ' + fieldDash(clipStr(s.completionCriteria, 100)) + '</p>');
    lines.push('<p class="meta task-card-field"><span class="task-card-lbl">截止</span> ' + (s.dueAt ? esc(String(s.dueAt).slice(0, 10)) : '—') + '</p>');
    lines.push('<p class="meta task-card-field"><span class="task-card-lbl">执行动作</span> ' + fieldDash(clipStr((s.actions || []).join('；'), 100)) + '</p>');
    lines.push('<p class="meta task-card-field"><span class="task-card-lbl">前置依赖</span> ' + (s.dependsOn && s.dependsOn.length ? esc(clipStr(depTitles(subs, s.dependsOn), 100)) : '—') + '</p>');
    return lines.join('');
  }`.trim();
}
