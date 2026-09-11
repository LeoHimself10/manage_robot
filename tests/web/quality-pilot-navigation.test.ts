import {afterEach, expect, it, vi} from 'vitest';
import {sanitizeQualityPilotNextPath, QUALITY_PILOT_PREFIX as prefix} from '../../src/web/quality-pilot-navigation';
import {resolveQualityPerspectiveContext} from '../../src/quality/presentation/quality-event-perspective';

afterEach(()=>vi.unstubAllEnvs());
const page=(path:string)=>['/workbench/quality','/workbench/manager/chat'].includes(path);
it('preserves the new Ma/Tong login destination instead of falling back to the old task home',()=>{
  for(const path of ['/ma-workbench/','/tong/?record=oa_123','/workbench/quality?perspective=manager']){
    expect(sanitizeQualityPilotNextPath(prefix+path,page,true)).toBe(prefix+path);
    expect(sanitizeQualityPilotNextPath(prefix+path,page,false)).toBeUndefined();
  }
});
it('rejects external, traversal, API, test identity and duplicate-prefix destinations',()=>{
  for(const path of ['//evil.test/x',prefix+'/../../workbench/quality',prefix+'/api/workbench/login',prefix+prefix+'/ma-workbench/',prefix+'/tong/?testActor=manager-1',prefix+'/workbench/quality?managerUserId=other','https://evil.test/'+prefix]){
    expect(sanitizeQualityPilotNextPath(path,page,true)).toBeUndefined();
  }
});
it('uses only the explicitly granted pilot identity for each business view',()=>{
  vi.stubEnv('WORKBENCH_ADMIN_USER_IDS','pilot-cao,other-admin');
  vi.stubEnv('QUALITY_PILOT_BUSINESS_USER_ID','pilot-cao');
  vi.stubEnv('QUALITY_TEST_ACTORS_ENABLED','0');
  for(const perspective of ['aftersales','quality_management','manager','employee'] as const){
    expect(resolveQualityPerspectiveContext({viewerUserId:'pilot-cao',perspective})).toMatchObject({scope:'real',actorUserId:'pilot-cao',perspective,readonly:false,isAdmin:false,testActor:null});
    expect(resolveQualityPerspectiveContext({viewerUserId:'other-admin',perspective})).toMatchObject({readonly:true,isAdmin:true});
  }
  expect(resolveQualityPerspectiveContext({viewerUserId:'pilot-cao',perspective:'dashboard'})).toMatchObject({readonly:true});
});
