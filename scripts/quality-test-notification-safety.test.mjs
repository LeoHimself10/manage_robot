import assert from 'node:assert/strict';
import {createWorkbenchPublishNotifier} from '../src/integrations/dingtalk/workbench-notify.ts';
process.env.WORKBENCH_DINGTALK_NOTIFY_ENABLED='0';
let calls=0;
const notifier=createWorkbenchPublishNotifier(async()=>{calls++;throw Error('Network must not be called');});
const input={recipientUserId:'real-looking-user',managerUserId:'manager',assigneeUserId:'employee',assignees:[{userId:'employee'}],taskNo:'TEST',title:'TEST',subtaskTitle:'TEST',taskTitle:'TEST',kind:'completed',unionId:'union'};
for(const [name,fn] of Object.entries(notifier)){
 const result=await fn(input);assert.equal(result.enabled,false,name);console.log(name,'suppressed');
}
assert.equal(calls,0);console.log('Zero outbound network calls');
