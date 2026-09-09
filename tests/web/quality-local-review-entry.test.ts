import type { IncomingMessage, ServerResponse } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { createQualityStore } from "../../src/quality/infra/quality-store";
import { handleQualityHttp } from "../../src/web/quality-http";
import { localQualityReviewEntry } from "../../src/web/quality-local-review-entry";

describe("connected local quality page navigation", () => {
  let directory: string;
  beforeEach(() => {
    directory=mkdtempSync(join(tmpdir(),"quality-local-entry-"));
    vi.stubEnv("WORKBENCH_SQLITE_PATH",join(directory,"workbench.sqlite"));
    vi.stubEnv("WORKBENCH_ADMIN_USER_IDS","local-admin");
    vi.stubEnv("WORKBENCH_MANAGER_USER_IDS","local-ma");
    vi.stubEnv("QUALITY_AFTERSALES_MANAGER_USER_IDS","local-ma");
    vi.stubEnv("QUALITY_MANAGEMENT_USER_IDS","local-tong");
    vi.stubEnv("QUALITY_EVENT_ROLE_PANELS_ENABLED","1");
    vi.stubEnv("QUALITY_TEST_ACTORS_ENABLED","1");
    vi.stubEnv("WORKBENCH_ADMIN_TEST_SYSTEM_ENABLED","1");
    vi.stubEnv("QUALITY_LOCAL_REVIEW_UI_ENABLED","1");
    createQualityStore().close();
  });
  afterEach(() => {vi.unstubAllEnvs();rmSync(directory,{recursive:true,force:true});});

  function page(userId: string, path="/workbench/quality", options: {host?:string;method?:string;external?:boolean}={}) {
    const result={status:0,body:"",headers:{} as Record<string,string>};
    const response={
      writeHead(status:number,headers:Record<string,string>){result.status=status;result.headers=headers??{};},
      end(body?:string){result.body=body??"";},
    } as ServerResponse;
    handleQualityHttp({req:{method:options.method??"GET"} as IncomingMessage,res:response,
      url:new URL((options.host??"http://127.0.0.1:8797")+path),
      session:{userId,role:userId==="local-admin"?"admin":userId.includes("tong")||userId.includes("SPECIALIST")?"employee":"manager",...(options.external?{loginSource:"external_password" as const}:{})},
    });
    return result;
  }

  it("routes effective Ma/Tong identities, including administrator impersonation targets, to their approved pages",()=>{
    for(const [id,destination] of [["local-ma","http://127.0.0.1:8808/ma-workbench/"],["QUALITY_TEST_AFTERSALES_001","http://127.0.0.1:8808/ma-workbench/"],["local-tong","http://127.0.0.1:8809/"],["QUALITY_TEST_SPECIALIST_001","http://127.0.0.1:8809/"]]){
      const response=page(id!);expect(response.status).toBe(302);expect(response.headers.Location).toBe(destination);expect(response.body).toBe("");
    }
    expect(page("local-ma","/workbench/quality",{method:"HEAD"}).status).toBe(302);
    expect(page("local-admin","/workbench/quality?testActor=quality-management").headers.Location).toBe("http://127.0.0.1:8809/");
  });
  it("keeps role and external-login gates before the redirect and ignores forged target roles",()=>{
    expect(page("no-quality-access").status).toBe(403);
    expect(page("local-ma","/workbench/quality",{external:true}).status).toBe(403);
    expect(page("local-tong","/workbench/quality/review").status).toBe(403);
    expect(page("local-ma","/workbench/quality?testActor=quality-management").headers.Location).toBe("http://127.0.0.1:8808/ma-workbench/");
  });
  it("leaves deployment URLs and the default disabled runtime on their existing page",()=>{
    expect(page("local-ma","/workbench/quality",{host:"https://manage.example.com"}).status).toBe(200);
    vi.stubEnv("QUALITY_LOCAL_REVIEW_UI_ENABLED","");
    expect(page("local-ma").status).toBe(200);
    expect(page("local-ma").body).toContain("qualityProcessingCenter");
  });
  it("retains original record deep links and manager/employee task views",()=>{
    expect(page("local-ma","/workbench/quality?eventId=existing-event").status).toBe(200);
    expect(page("local-ma","/workbench/quality/review?sourceKey=existing-source").status).toBe(200);
    expect(page("QUALITY_TEST_MANAGER_001").status).toBe(200);
    for(const perspective of ["manager","employee","dashboard"] as const){
      expect(localQualityReviewEntry({url:new URL("http://127.0.0.1:8797/workbench/quality"),perspective,readonly:false})).toBeNull();
    }
  });
  it("never redirects APIs or a read-only business perspective to an editable UI",()=>{
    expect(localQualityReviewEntry({url:new URL("http://127.0.0.1:8797/api/workbench/quality/events"),perspective:"aftersales",readonly:false})).toBeNull();
    expect(localQualityReviewEntry({url:new URL("http://127.0.0.1:8797/workbench/quality"),perspective:"aftersales",readonly:true})).toBeNull();
  });
});
