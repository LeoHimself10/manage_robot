const fs=require('fs'),path=require('path');
const {chromium}=require('C:/Users/EDY/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const base='http://127.0.0.1:8808/ma-workbench/',checks=[],errors=[],requests=[];
function check(name,ok){checks.push({name,passed:!!ok});if(!ok)throw Error(name);}
const text=p=>p.locator('#detailContent').innerText();
async function screenshot(p,name){await p.screenshot({path:path.join(__dirname,'flow-'+name+'.png'),fullPage:false});}
(async()=>{
 const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 const p=await browser.newPage({viewport:{width:1366,height:768},acceptDownloads:true});
 p.on('pageerror',e=>errors.push(e.message));p.on('request',r=>requests.push({url:r.url(),method:r.method()}));
 try{
  await p.goto(base+'?record=a8&view=event');
  check('Current user record is a complete flow example',await p.locator('#detail .detail-title').innerText()==='图像导出时间较长'&&await p.locator('#flowExampleControls').innerText().then(t=>t.includes('完整结果')));
  check('Default example shows closed quality result',await text(p).then(t=>t.includes('已关闭')));
  check('Five example states are discoverable in event',await p.locator('[data-flow-scene]').count()===5);
  await p.evaluate(()=>window.originalPhaseBar=document.querySelector('#detailFlow'));
  await p.locator('[data-phase="2"]').click();
  check('Tong initial analysis has substantive export-specific content',await text(p).then(t=>t.includes('逐帧写入')&&t.includes('取消场景')));
  check('Initial analysis has independently selectable V1/V2',await p.locator('#analysisVersion option').count()===2);
  await p.locator('#analysisVersion').selectOption('1');check('Old analysis remains read-only and visible',await text(p).then(t=>t.includes('历史 V1')));await p.locator('#analysisVersion').selectOption('2');
  await p.locator('#detailContent').scrollIntoViewIfNeeded();await screenshot(p,'analysis-1366');
  await p.locator('[data-phase="3"]').click();
  check('Assignment stage shows four assignment rows',await p.locator('.assignment-table tbody tr').count()===4);
  check('Assignment has three department supervisors',await p.locator('.assignment-owners article').count()===3);
  check('Each assignment has different work and owner',new Set(await p.locator('.assignment-table tbody tr td:first-child b').allTextContents()).size===4&&new Set(await p.locator('.assignment-table tbody tr td:nth-child(2) b').allTextContents()).size===4);
  await p.locator('#detailContent').scrollIntoViewIfNeeded();await screenshot(p,'assignment-1366');
  await p.locator('.assignment-table [data-task=a8-t3]').click();
  check('Assignment links into selected employee result',await p.locator('#task-a8-t3').getAttribute('open')!==null&&await p.locator('[data-phase="4"]').getAttribute('aria-pressed')==='true');
  check('Employee result includes own supervisor and detailed delivery',await p.locator('#task-a8-t3').innerText().then(t=>t.includes('顾宁')&&t.includes('20 项')&&t.includes('完整承办记录')));
  await p.locator('#task-a8-t3').scrollIntoViewIfNeeded();await screenshot(p,'employee-1366');
  check('History distinguishes return, new evidence and final acceptance',await p.locator('#task-a8-t3 .timeline').innerText().then(t=>t.includes('主管退回补充')&&t.includes('补交证据 V2')&&t.includes('主管验收通过')));
  await p.locator('#task-a8-t3 [data-evidence]').click();check('Evidence opens with correct task and latest version',await p.locator('#evidenceBody').innerText().then(t=>t.includes('回归验证记录')&&t.includes('V2')));
  await p.locator('#evidenceVersion').selectOption('1');check('Original evidence preserves missing-scene reason',await p.locator('#evidenceBody').innerText().then(t=>t.includes('缺少慢速介质')));
  const dp=p.waitForEvent('download');await p.locator('[data-download-evidence]').click();const download=await dp;check('Historical evidence is downloadable',download.suggestedFilename().includes('V1'));await p.locator('[data-close-evidence]').click();
  await p.locator('[data-phase="5"]').click();check('Quality result has concrete closure, causes and measures',await text(p).then(t=>t.includes('质量终验通过')&&t.includes('批量写入')&&t.includes('20 / 20')));
  check('Three different capacity measurements are displayed',await p.locator('.validation-results tbody tr').count()===3);
  check('Final quality check differs from supervisor results',await p.locator('.quality-check').count()===3&&await p.locator('.supervisor-results .record-line').count()===4);
  await p.locator('#detailContent').scrollIntoViewIfNeeded();await screenshot(p,'audit-1366');
  check('Switching phase leaves shared navigation mounted',await p.evaluate(()=>window.originalPhaseBar===document.querySelector('#detailFlow')));
  await p.locator('[data-audit-tab=activity]').click();await p.locator('[data-activity-filter="初析"]').click();
  check('Activity filter resolves the two real example analysis versions',await p.locator('.activity-item').count()===2);
  await p.locator('[data-activity-filter="承办"]').click();check('Employee activities have several concrete results',await p.locator('.activity-item').count()>=4);
  await p.locator('[data-flow-scene=assigned]').click();await p.locator('[data-phase="4"]').click();
  check('Assigned scene has four pending tasks',await p.locator('.task-card').count()===4&&await p.evaluate(()=>flows.a8.tasks.every(t=>t.status==='pending'&&!t.accepted&&!t.evidence.length)));
  await p.locator('[data-flow-scene=execution]').click();
  check('Execution scene includes passed, active, returned and pending',await p.evaluate(()=>new Set(flows.a8.tasks.map(t=>t.status)).size===4));
  await p.locator('#task-a8-t2 > summary').click();check('Active task contains 65 percent progress with concrete update',await p.locator('#task-a8-t2').innerText().then(t=>t.includes('65%')&&t.includes('联调取消操作')));
  await p.locator('#task-a8-t3 > summary').click();check('Returned task shows required supplementary records',await p.locator('#task-a8-t3').innerText().then(t=>t.includes('缺少慢速介质和取消场景对照')));
  await p.locator('[data-task-filter="执行与补充"]').click();check('Task status filter works with distinct sample states',await p.locator('.task-card').count()===2);
  await p.locator('#detailContent').scrollIntoViewIfNeeded();await screenshot(p,'execution-1366');
  await p.locator('[data-flow-scene=quality]').click();await p.locator('[data-phase="5"]').click();
  check('Pending quality scene is not shown as accepted',await p.locator('.quality-review-banner').innerText().then(t=>t.includes('等待佟成终验'))&&await p.locator('.quality-check .waiting').count()===3);
  await p.locator('[data-flow-scene=returned]').click();
  check('Quality return names the specific task and reason',await p.locator('.quality-return-node').innerText().then(t=>t.includes('回归')&&t.includes('其他 3 项')));
  await p.locator('#detailContent').scrollIntoViewIfNeeded();await screenshot(p,'quality-return-1366');
  await p.locator('.quality-return-node [data-task]').click();
  check('Quality return opens the affected employee node',await p.locator('#task-a8-t3').getAttribute('open')!==null&&await p.locator('#task-a8-t3').innerText().then(t=>t.includes('质量终验指定节点退回')));
  check('Quality return preserves earlier supervisor acceptance and evidence',await p.evaluate(()=>flows.a8.tasks[2].evidence[0].versions.length===2&&flows.a8.tasks[2].history.some(h=>h.title==='主管验收通过')));
  await p.locator('#detail .detail-tabs [data-tab=overview]').click();await p.locator('[data-update=a8]').click();
  check('Supplement creates V3 awaiting acceptance, not a silent pass',await p.evaluate(()=>flows.a8.tasks[2].status==='submitted'&&flows.a8.tasks[2].evidence[0].versions.length===3));
  await p.locator('[data-flow-scene=closed]').click();
  check('Scenario changes preserve the same event identifier',await p.locator('#detail .detail-eyebrow').innerText().then(t=>t.includes('QT-DEMO-20260905-008')));
  await p.locator('#detail .detail-tabs [data-tab=review]').click();check('Human review matches export event and excludes removed handling',await text(p).then(t=>t.includes('数据、报告与测量')&&!t.includes('处理方式')));
  for(const width of [1366,1920]){
   await p.setViewportSize({width,height:width===1366?768:1080});
   for(const [phase,name] of [['2','analysis'],['3','assignment'],['4','employee'],['5','audit']]){
    await p.locator(`[data-phase="${phase}"]`).click();if(phase==='4')await p.locator('#task-a8-t3 > summary').click();await p.locator('#detailContent').scrollIntoViewIfNeeded();
    check(`No page overflow for ${name} at ${width}`,await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
    await screenshot(p,name+'-'+width);
   }
  }
  await p.goto(base+'?record=a2&view=event');await p.locator('#flowExampleControls [data-open-flow-example]').click();
  check('An unfinished record offers direct access to complete prototype',await p.locator('#detail .detail-title').innerText()==='图像导出时间较长');
  await p.goto(base+'?record=a1');await p.locator('.scope-summary [data-open-flow-example]').click();
  check('Inbox complete-example shortcut opens full analysis directly',await p.locator('#detailContent').innerText().then(t=>t.includes('质量初析 V2')));
  await p.locator('.event-toolbar [data-return-feedback]').click();await p.waitForFunction(()=>viewState.surface==='feedback');
  check('Example return goes back to inbox',await p.locator('#inbox').isVisible());
  check('No browser runtime errors',errors.length===0);
  check('No external data or business mutation requests',requests.every(r=>r.method==='GET'&&r.url.startsWith('http://127.0.0.1:8808/')&&!r.url.includes('/api/')));
 }finally{
  fs.writeFileSync(path.join(__dirname,'flow-examples-verification.json'),JSON.stringify({at:new Date().toISOString(),checks,errors},null,2));
  console.log(JSON.stringify({passed:checks.filter(t=>t.passed).length,failed:checks.filter(t=>!t.passed),errors}));await browser.close();
 }
})().catch(e=>{console.error(e);process.exit(1)});
