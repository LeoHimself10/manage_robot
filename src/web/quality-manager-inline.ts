/** Manager acceptance shares the original formal-task endpoint and responsibility guards. */
export const QUALITY_MANAGER_INLINE_STYLES = String.raw`
.qm-review{padding:20px;border:1px solid #cfddf4;border-radius:7px;background:#fbfdff;margin-top:16px;color:#17385e;font-size:14px;line-height:1.7}
.qm-review h5{font-size:16px;margin:0 0 8px}.qm-review p{margin:6px 0 14px}.qm-review label{display:block}.qm-review textarea{display:block;box-sizing:border-box;width:100%;min-height:96px;padding:12px;margin:8px 0 14px;border:1px solid #bed2f2;border-radius:6px;font:inherit;line-height:1.7;resize:vertical;color:inherit}.qm-actions{display:flex;gap:12px;flex-wrap:wrap}.qm-review button{min-height:42px}.qm-target{background:#fff7eb;border:1px solid #f3d5a9;border-radius:5px;padding:12px 14px;margin:12px 0;white-space:pre-wrap;overflow-wrap:anywhere}.qm-feedback{white-space:pre-wrap;color:#b03939;margin-top:10px}.qm-feedback:empty{display:none}.qpc-unified .qpc-stages.is-five-stage{grid-template-columns:repeat(5,minmax(0,1fr))}.qm-review select{display:block;width:100%;min-height:44px;margin:8px 0;padding:8px;border:1px solid #bed2f2;background:white;color:inherit;font:inherit}.qm-review textarea:focus{outline:2px solid #abc7f5;outline-offset:1px}
`;

export const QUALITY_MANAGER_INLINE_SCRIPT = String.raw`
  function renderManagerReturnPanel(view, mount) {
    if(view.readonly || view.perspective !== 'manager')return;
    (view.managerReturns || []).forEach(function(item){
      var shell=make('section','qm-review');shell.appendChild(make('h5','','佟成退回：请主管补充处理'));
      shell.appendChild(make('p','qm-target',item.reason));
      var label=make('label','','处理方式'),select=make('select');select.setAttribute('aria-label','主管退回处理方式');
      var option=make('option','','已补充统筹说明，重新提交质量终验');option.value='';select.appendChild(option);
      item.children.forEach(function(child){var o=make('option','', '退回 '+child.name+' · '+child.title);o.value=child.nodeId;select.appendChild(o);});label.appendChild(select);shell.appendChild(label);
      var field=make('label','','处理说明或员工补充要求 *'),note=make('textarea');note.maxLength=2000;note.placeholder='说明已完成的补充处理；选择员工任务时，填写其需补充的内容';field.appendChild(note);shell.appendChild(field);
      var button=make('button','btn btn-primary','重新提交质量终验');button.type='button';shell.appendChild(button);var feedback=make('p','qm-feedback');feedback.setAttribute('role','status');shell.appendChild(feedback);
      select.onchange=function(){button.textContent=select.value?'确认退回选中员工任务':'重新提交质量终验';};
      var attempt=null,pending=false;
      button.onclick=async function(){
        if(pending)return;var reason=note.value.trim();if(!reason){feedback.textContent='请填写处理说明或补充要求。';note.focus();return;}
        var fingerprint=select.value+'\n'+reason;if(!attempt||attempt.fingerprint!==fingerprint)attempt={fingerprint:fingerprint,requestId:crypto.randomUUID()};
        pending=true;button.disabled=select.disabled=note.disabled=true;
        try{var response=await fetch('/api/workbench/quality/nodes/'+encodeURIComponent(item.nodeId)+'/manager-return',jsonOptions('POST',{expectedVersion:view.event.version,childNodeId:select.value,reason:reason,requestId:attempt.requestId}));var result=await response.json();if(!response.ok||!result.ok)throw Error(result.error||'处理未完成');await selectEvent(view.event.actionRef,true);await Promise.all([loadList(),loadMetrics()]);}
        catch(error){feedback.textContent=error.message;}
        finally{pending=false;button.disabled=select.disabled=note.disabled=false;}
      };mount.appendChild(shell);
    });
  }
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
