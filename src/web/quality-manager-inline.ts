/** Manager acceptance shares the original formal-task endpoint and responsibility guards. */
export const QUALITY_MANAGER_INLINE_STYLES = String.raw`
.qm-review{padding:20px;border:1px solid #cfddf4;border-radius:7px;background:#fbfdff;margin-top:16px;color:#17385e;font-size:14px;line-height:1.7}
.qm-review h5{font-size:16px;margin:0 0 8px}.qm-review p{margin:6px 0 14px}.qm-review label{display:block}.qm-review textarea{display:block;box-sizing:border-box;width:100%;min-height:96px;padding:12px;margin:8px 0 14px;border:1px solid #bed2f2;border-radius:6px;font:inherit;line-height:1.7;resize:vertical;color:inherit}.qm-actions{display:flex;gap:12px;flex-wrap:wrap}.qm-review button{min-height:42px}.qm-target{background:#fff7eb;border:1px solid #f3d5a9;border-radius:5px;padding:12px 14px;margin:12px 0;white-space:pre-wrap;overflow-wrap:anywhere}.qm-feedback{white-space:pre-wrap;color:#b03939;margin-top:10px}.qm-feedback:empty{display:none}.qm-review textarea:focus{outline:2px solid #abc7f5;outline-offset:1px}
`;

export const QUALITY_MANAGER_INLINE_SCRIPT = String.raw`
  function renderManagerInlineReview(view, item, mount) {
    if (view.readonly || view.perspective !== 'manager' || !item.canReview || !item.reviewNodeId) return;
    var shell = make('section', 'qm-review'), title = make('h5', '', '主管验收');
    shell.appendChild(title);
    shell.appendChild(make('p', '', '核对上方任务要求、完成说明与证据后，在这里完成验收。'));
    var target = make('div', 'qm-target'); target.hidden = true; shell.appendChild(target);
    var label = make('label'), labelText = make('span', '', '验收意见（选填）'), note = document.createElement('textarea');
    note.maxLength = 2000; note.placeholder = '填写核对结果或验收意见'; label.appendChild(labelText); label.appendChild(note); shell.appendChild(label);
    var actions = make('div', 'qm-actions'), approve = make('button', 'btn btn-primary', '验收通过'), returnButton = make('button', 'btn btn-secondary', '退回补充'), cancel = make('button', 'btn btn-secondary', '取消退回');
    [approve, returnButton, cancel].forEach(function(button) { button.type = 'button'; actions.appendChild(button); }); cancel.hidden = true;
    shell.appendChild(actions); var feedback = make('div', 'qm-feedback'); feedback.setAttribute('role', 'status'); shell.appendChild(feedback);
    var returning = false, pending = false, attempt = null;
    function setReturning(value) {
      returning = value; target.hidden = !value; approve.hidden = value; cancel.hidden = !value;
      returnButton.textContent = value ? '确认退回该任务' : '退回补充';
      target.textContent = '退回节点：' + item.assigneeName + ' · ' + qualityTaskDisplayTitle(item) + '\n仅此任务恢复为待补充；其他任务的验收结果与历史证据保留。';
      labelText.textContent = value ? '退回原因与补充要求 *' : '验收意见（选填）';
      note.placeholder = value ? '说明哪里不符合要求，以及需要补充的内容或证据' : '填写核对结果或验收意见'; note.required = value; feedback.textContent = ''; if (value) note.focus();
    }
    async function submit(decision) {
      if (pending) return;
      var reason = note.value.trim(); if (decision === 'RETURN' && !reason) { feedback.textContent = '请填写退回原因与补充要求。'; note.focus(); return; }
      var fingerprint = decision + '\n' + reason;
      if (!attempt || attempt.fingerprint !== fingerprint) attempt = { fingerprint: fingerprint, requestId: crypto.randomUUID() };
      pending = true; [approve, returnButton, cancel].forEach(function(button) { button.disabled = true; }); note.disabled = true; feedback.textContent = '正在保存验收结果…';
      try {
        var response = await fetch('/api/workbench/manager/quality-review', jsonOptions('POST', { subtaskId: item.actionRef, expectedVersion: item.reviewNodeVersion, decision: decision, reason: reason, requestId: attempt.requestId }));
        var result = await response.json().catch(function() { return {}; });
        if (!response.ok || !result.ok) throw new Error(result.error || '验收未完成，请重试');
        var opened = Array.from(document.querySelectorAll('details[data-review-subtask][open]')).map(function(el) { return el.getAttribute('data-review-subtask'); });
        await selectEvent(view.event.actionRef, true); await Promise.all([loadList(), loadMetrics()]);
        document.querySelectorAll('details[data-review-subtask]').forEach(function(el) { if (opened.indexOf(el.getAttribute('data-review-subtask')) >= 0) { el.open = true; var parent = el.parentElement && el.parentElement.closest('details'); if (parent) parent.open = true; } });
      } catch (error) { feedback.textContent = error.message || '验收未完成，请重试'; }
      finally { pending = false; [approve, returnButton, cancel].forEach(function(button) { button.disabled = false; }); note.disabled = false; }
    }
    approve.addEventListener('click', function() { void submit('APPROVE'); });
    returnButton.addEventListener('click', function() { if (!returning) setReturning(true); else void submit('RETURN'); });
    cancel.addEventListener('click', function() { setReturning(false); }); mount.appendChild(shell);
  }
`;
