// Verify the deployed UI against the exact local version approved by the user.
// Run after the three browser bundles are built, before packaging the release.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync,readdirSync} from 'node:fs';
import {resolve,relative,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const lock=JSON.parse(readFileSync(resolve(root,'quality-release.lock.json'),'utf8'));
const git=(...args)=>execFileSync('git',args,{cwd:root,maxBuffer:20*1024*1024});
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const normalized=bytes=>Buffer.from(bytes.toString('utf8').replaceAll('\r\n','\n'));
let verified=0;
for(const mapping of lock.ui){
  const sourceFiles=git('ls-tree','-r','--name-only',lock.uiCommit,'--',mapping.source).toString().trim().split('\n');
  for(const source of sourceFiles){
    const name=source.slice(mapping.source.length+1);
    if(!name||name.startsWith('revisions/')||name.startsWith('qa/')||name.startsWith('.')||name==='README.md')continue;
    const destination=mapping.destination+'/'+name;
    const sourceBytes=git('show',lock.uiCommit+':'+source);
    const deployed=readFileSync(resolve(root,destination));
    if(lock.productionOnlyFiles[destination]){
      assert.equal(hash(normalized(deployed)),lock.productionOnlyFiles[destination].sha256,destination+' production adaptation changed');
    }else if(/\.(?:js|css|html|svg|txt)$/.test(name)){
      assert.equal(hash(normalized(deployed)),hash(normalized(sourceBytes)),destination+' differs from approved UI');
    }else{
      assert.equal(hash(deployed),hash(sourceBytes),destination+' differs from approved asset');
    }
    verified++;
  }
}
// All original backend changes are limited to reviewed integration/auth/navigation
// files. Formal task execution, evidence and acceptance stay on the approved code.
const backendChanges=git('diff','--name-only',lock.backendCommit,'--','src').toString().trim().split('\n').filter(Boolean);
for(const file of backendChanges){
  const expected=lock.productionOnlyFiles[file];
  assert.ok(expected,'Unreviewed change to approved backend: '+file);
  assert.equal(hash(normalized(readFileSync(resolve(root,file)))),expected.sha256,file+' production adaptation changed');
}
for(const file of git('ls-files','--others','--exclude-standard','src').toString().trim().split('\n').filter(Boolean)){
  assert.fail('Untracked backend source is not approved: '+file);
}
const files={};
function collect(folder){
  for(const item of readdirSync(resolve(root,folder),{withFileTypes:true})){
    const path=folder+'/'+item.name;
    if(item.isDirectory())collect(path);
    else if(item.isFile())files[path]=hash(readFileSync(resolve(root,path)));
  }
}
for(const folder of ['src','dist','public/quality'])collect(folder);
for(const file of lock.runtimeScripts)files[file]=hash(readFileSync(resolve(root,file)));
files['quality-release.lock.json']=hash(readFileSync(resolve(root,'quality-release.lock.json')));
const manifest={release:lock.release,uiCommit:lock.uiCommit,backendCommit:lock.backendCommit,verifiedUiFiles:verified,files};
const manifestPath=resolve(root,'quality-release.json');
if(process.argv.includes('--write'))writeFileSync(manifestPath,JSON.stringify(manifest,null,2)+'\n');
else assert.deepEqual(JSON.parse(readFileSync(manifestPath,'utf8')),manifest,'Release manifest is stale; rebuild and verify');
console.log(JSON.stringify({ok:true,release:lock.release,verifiedUiFiles:verified,packagedFiles:Object.keys(files).length}));
