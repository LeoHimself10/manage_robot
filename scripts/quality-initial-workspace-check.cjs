const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const {chromium} = require('C:/Users/EDY/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');

// Isolated browser storage; AI responses are intercepted, so this check uses no model quota.
(async () => {
  const out = path.resolve('docs/mockups/tong-workbench-20260908/qa/initial-workspace-20260909');
  fs.mkdirSync(out, {recursive:true});
  const browser = await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe', headless:true});
  const results=[], errors=[];
  let calls=0, completeAi;
  try {
    const page=await browser.newPage({viewport:{width:1366,height:768}});
    page.on('pageerror',e=>errors.push(e.message));
    await page.route('**/api/quality-ui/status',r=>r.fulfill({json:{ok:true,data:{connected:true}}}));
    await page.route('**/api/quality-ui/initial-analysis',async route=>{
      calls++;
      const response=await new Promise(resolve=>{completeAi=resolve;});
      await route.fulfill(response);
    });
    await page.goto('http://127.0.0.1:8809/?record=a4&tab=analysis&scope='+encodeURIComponent('待我初析'));
    await page.locator('.initial-workspace-header').waitFor();
    const fixture=await page.evaluate(()=>{
      const e=eventById(), a1=initialAttempt(e,1), a2=initialAttempt(e,2);
      a1.output.departmentCandidates=[{name:'研发中心',reason:'第一版技术核查建议'}];
      a2.output.departmentCandidates=[{name:'生产中心',reason:'第二版生产核查建议'}];
      a2.output.initialConclusion='第二次 AI 建议：补充对照验证。';
      e.initialAi={attempts:[a1,a2],feedback:'旧版重复提示'};
      e.editor=initialDraftFrom(e,a1);
      e.editor.initialConclusion='人工已核对：等待设备日志。';
      e.editor.confirmedFacts='已核实设备型号为 ACR-01；尚未核实故障根因。';
      e.initialHumanTouched=true;e.draft=null;e.initialDraftHistory=[];
      persist();render();
      return {raw:JSON.stringify(e.initialAi.attempts),source:e.editor.sourceSummary,first:a1.id,second:a2.id};
    });
    assert.equal(await page.locator('#analysisForm').count(),1);
    assert.equal(await page.locator('.initial-reference').getAttribute('open'),null);
    assert.equal(await page.locator('.initial-ai').isVisible(),false);
    assert.equal(await page.locator('textarea[name=sourceSummary]').isVisible(),false);
    assert.equal(await page.locator('textarea[name=confirmedFacts]').isVisible(),true);
    assert.match(await page.locator('.initial-new-version').innerText(),/第 2 次[\s\S]*第 1 次/);
    assert.match(await page.locator('#initialDepartmentCandidates').innerText(),/第一版技术核查/);
    assert.equal(calls,0);
    results.push('默认仅一份编辑草稿；AI 原稿折叠，版本差异提示清楚，部门建议与草稿版本一致');

    for(const viewport of [{width:1366,height:768},{width:1920,height:1080}]){
      await page.setViewportSize(viewport);
      await page.locator('#initialDraftStart').evaluate(el=>el.scrollIntoView({block:'start'}));
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
      await page.screenshot({path:path.join(out,viewport.width+'-draft.png')});
    }
    results.push('1366×768 与 1920×1080 无横向溢出');
    await page.locator('textarea[name=initialConclusion]').fill('人工修改应在版本对照和生成期间保留。');
    await page.locator('[data-initial=compare-latest]').click();
    assert.equal(await page.locator('.initial-ai').isVisible(),true);
    assert.equal(await page.locator('#initialAttemptSelect').inputValue(),fixture.second);
    await page.locator('#initialAttemptSelect').selectOption(fixture.first);
    assert.equal(await page.locator('.initial-ai').isVisible(),true);
    assert.equal(await page.locator('textarea[name=initialConclusion]').inputValue(),'人工修改应在版本对照和生成期间保留。');
    await page.locator('#initialAttemptSelect').selectOption(fixture.second);
    await page.locator('[data-initial=prefill]').last().click();
    await page.locator('[data-action=close-dialog]').click();
    assert.equal(await page.locator('textarea[name=initialConclusion]').inputValue(),'人工修改应在版本对照和生成期间保留。');
    assert.equal(await page.evaluate(()=>eventById().editor.initialAiAttemptId),fixture.first);
    results.push('展开、切换历史版本、取消预填均不覆盖人工内容');

    await page.locator('[data-initial=prefill]').last().click();
    await page.locator('#dialogConfirm').click();
    assert.equal(await page.locator('.initial-reference').getAttribute('open'),null);
    assert.equal(await page.locator('.initial-new-version').count(),0);
    assert.equal(await page.locator('textarea[name=initialConclusion]').inputValue(),'第二次 AI 建议：补充对照验证。');
    assert.match(await page.locator('#initialDepartmentCandidates').innerText(),/第二版生产核查/);
    assert.deepEqual(await page.evaluate(()=>({id:eventById().editor.initialAiAttemptId,history:eventById().initialDraftHistory[0].content.initialConclusion,raw:JSON.stringify(eventById().initialAi.attempts)})),{id:fixture.second,history:'人工修改应在版本对照和生成期间保留。',raw:fixture.raw});
    results.push('确认预填后更新草稿版本、保存旧人工副本，AI 快照未改变');

    await page.locator('.initial-source-context>summary').click();
    await page.locator('textarea[name=sourceSummary]').fill('来源描述经整理：反馈人报告参数校验异常。');
    await page.locator('.initial-source-context>summary').click();
    await page.locator('textarea[name=confirmedFacts]').fill('人工核实：安装记录与设备编号一致。');
    await page.locator('[data-action=save-analysis]').click();
    await page.reload();
    await page.locator('.initial-workspace-header').waitFor();
    assert.equal(await page.locator('textarea[name=sourceSummary]').inputValue(),'来源描述经整理：反馈人报告参数校验异常。');
    assert.equal(await page.locator('textarea[name=confirmedFacts]').inputValue(),'人工核实：安装记录与设备编号一致。');
    assert.equal(await page.evaluate(()=>eventById().editor.initialAiAttemptId),fixture.second);
    assert.equal(await page.locator('.initial-reference').getAttribute('open'),null);
    results.push('折叠字段与核实事实分别保存，刷新后完整保留');

    await page.locator('[data-initial=generate]').click();
    await page.waitForFunction(()=>eventById().initialAi.attempts.at(-1).status==='GENERATING');
    await page.locator('textarea[name=initialConclusion]').fill('生成期间人工继续编辑的结论。');
    assert.equal(await page.locator('[data-initial=generate]').isDisabled(),true);
    while(!completeAi)await new Promise(resolve=>setTimeout(resolve,20));
    completeAi({json:{ok:true,data:{createdAt:'2026-09-09T08:00:00Z',model:'qa-fixture',promptVersion:'qa-fixture',durationMs:25,usage:{totalTokens:0},input:{ruleContext:{version:'qa'},productKnowledge:{version:'qa'}},output:{problemDirection:'测试用新建议',confirmedCategoryReference:'设备功能 / 稳定性',sourceFactSummary:['测试来源摘要'],confirmedFacts:['测试事实'],analysisBasis:[{statement:'测试依据',sourceType:'SOURCE',sourceReference:'测试来源'}],preliminaryConclusion:'第三次 AI 建议',causeHypotheses:['待验证假设'],investigationDirections:['复测'],informationGaps:['日志'],handlingRequirements:['补充日志'],suggestedTotalDueDays:5,primaryDepartmentCandidates:[{departmentName:'研发中心',recommendationReason:'测试部门'}],deliverables:[{name:'复测记录',description:'复测过程',acceptanceCriteria:'可复核'}]}}}});
    completeAi=null;
    await page.waitForFunction(()=>eventById().initialAi.attempts.at(-1).status==='SUCCEEDED');
    assert.equal(await page.locator('textarea[name=initialConclusion]').inputValue(),'生成期间人工继续编辑的结论。');
    assert.match(await page.locator('.initial-new-version').innerText(),/第 3 次[\s\S]*第 2 次/);
    assert.equal(await page.locator('.initial-ai').isVisible(),false);
    assert.equal(await page.evaluate(()=>JSON.stringify(eventById().initialAi.attempts.slice(0,2))),fixture.raw);
    results.push('真实接口路径生成新版本（响应使用测试替身）保留生成期间的编辑和原稿');

    await page.locator('[data-initial=generate]').click();
    while(!completeAi)await new Promise(resolve=>setTimeout(resolve,20));
    completeAi({status:503,json:{ok:false,error:'QA 请求超时'}});completeAi=null;
    await page.locator('.initial-error').waitFor();
    assert.equal(await page.locator('.initial-ai').isVisible(),false);
    assert.equal(await page.locator('textarea[name=initialConclusion]').inputValue(),'生成期间人工继续编辑的结论。');
    assert.equal(await page.locator('[data-initial=generate]').isDisabled(),false);
    results.push('失败提示不藏在原稿内，仍可重试和编辑人工草稿');

    await page.locator('.initial-source-context>summary').click();
    await page.locator('textarea[name=sourceSummary]').fill('');
    await page.locator('.initial-source-context>summary').click();
    await page.locator('#analysisForm button[type=submit]').click();
    assert.equal(await page.locator('textarea[name=sourceSummary]').isVisible(),true);
    assert.match(await page.locator('#analysisError').innerText(),/来源事实摘要/);
    results.push('必填项遗漏时展开对应参考区，保留原有提交校验');
    assert.deepEqual(errors,[]);
    assert.equal(calls,2);
    fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({passed:true,results,pageErrors:errors,interceptedAiRequests:calls,realAiRequests:0},null,2));
    console.log(JSON.stringify({passed:true,checks:results.length,pageErrors:errors,realAiRequests:0,output:out},null,2));
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
