import http from 'node:http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadOriginalAiRuntime } from './quality-ui-ai-runtime.mjs';
import { createAiHandler } from './quality-ui-ai-http.mjs';
import {createOaHandler} from './quality-oa-http.mjs';
import {DatabaseSync} from 'node:sqlite';
import {existsSync} from 'node:fs';
import {createOaWorkflow} from './quality-oa-workflow.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const originalRoot = process.env.QUALITY_ORIGINAL_SYSTEM_ROOT || resolve(root, '..', 'yesterday-admin-test-actors');
const runtime = await loadOriginalAiRuntime(originalRoot);
const names={};
const directoryPath=resolve(root,'../..','data/local-production-db/workbench.sqlite');
if(existsSync(directoryPath)) {
  const directory=new DatabaseSync(directoryPath,{readOnly:true});
  try {for(const person of directory.prepare('SELECT user_id,name FROM dingtalk_contacts WHERE active=1').all())names[person.user_id]=person.name;}finally{directory.close();}
}
const oa=await createOaHandler({root,runtime,names,workflowFactory:store=>createOaWorkflow({store,originalRoot,modelEnv:runtime.modelEnv})});
const roots = {
  '8808':resolve(root,'docs/mockups/quality-oa-workflow-connected-20260909'),
  '8809':resolve(root,'docs/mockups/tong-workbench-20260908'),
};
const handler = createAiHandler({runtime,roots,journalPath:resolve(root,'data/quality-ui-ai/attempts.jsonl'),oa,
  designRoot:resolve(root,'docs/mockups/quality-connected-20260909')});
for (const port of Object.keys(roots)) {
  const server = http.createServer(handler);
  server.requestTimeout = 240000;
  server.on('error', err => {console.error('quality_ui_server_error',port,err.code);process.exit(1);});
  server.listen(Number(port),'127.0.0.1',() => console.log('quality_ui_ready',port,JSON.stringify(runtime.health)));
}
