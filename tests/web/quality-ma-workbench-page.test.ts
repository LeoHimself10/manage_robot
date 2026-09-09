import { describe, expect, it } from "vitest";
import { renderQualityMaWorkbenchPage } from "../../src/web/quality-ma-workbench-page";
import { QUALITY_MA_WORKBENCH_CLIENT } from "../../src/web/quality-ma-workbench-client";

describe("Ma feedback workbench page", () => {
  it("renders inside the formal workbench shell and labels the pending OA connection", () => {
    const html = renderQualityMaWorkbenchPage({ role: "manager", userId: "ma", displayName: "研判主管" });
    expect(html).toContain('id="maWorkbench"');
    expect(html).toContain("钉钉 OA 待接入");
    expect(html).toContain("反馈与质量跟踪");
    expect(html).not.toContain("本地测试数据");
    expect(html).not.toContain("flow-examples.js");
    expect(html).not.toContain("snapshotFixture");
    expect(html).not.toContain("QT-DEMO");
    expect(html).not.toContain("建议处理方式");
    expect(html).not.toContain("请选择处理方式");
  });

  it("does not allow an initial source key to inject markup or script", () => {
    const payload = '</template><script>alert("injected")</script>\u2028';
    const html = renderQualityMaWorkbenchPage({ role: "manager", userId: "ma", initialSourceKey: payload, readonly: true });
    const config = html.match(/<template id="maBootstrap">([\s\S]*?)<\/template>/)?.[1];
    expect(config).toBeTruthy();
    expect(config).not.toContain("<script>");
    expect(JSON.parse(config!).initialSourceKey).toBe(payload);
    expect(JSON.parse(config!).readonly).toBe(true);
    expect(() => [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].forEach((s) => new Function(s[1]!))).not.toThrow();
  });

  it("has a separate authenticated admission boundary and no artificial handling decision", () => {
    expect(QUALITY_MA_WORKBENCH_CLIENT).toContain("/api/workbench/quality/ma/feedbacks");
    expect(QUALITY_MA_WORKBENCH_CLIENT).toContain("credentials:'same-origin'");
    expect(QUALITY_MA_WORKBENCH_CLIENT).toContain("expectedSourceVersion:op.sourceVersion");
    expect(QUALITY_MA_WORKBENCH_CLIENT).toContain("expectedAssessmentVersion=op.assessmentVersion");
    expect(QUALITY_MA_WORKBENCH_CLIENT).not.toContain("handlingRecommendation");
    expect(QUALITY_MA_WORKBENCH_CLIENT).not.toContain("testActor=");
    expect(QUALITY_MA_WORKBENCH_CLIENT).toContain("正式质量事件编号将在研判推送成功后生成");
  });

  it("keeps all generated browser scripts valid for the isolated test view", () => {
    const html = renderQualityMaWorkbenchPage({ role: "manager", userId: "test-ma", displayName: "本地研判主管", isTest: true });
    expect(html).toContain("本地测试数据");
    const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((s) => s[1]!);
    expect(scripts.length).toBeGreaterThan(0);
    for (const script of scripts) expect(() => new Function(script)).not.toThrow();
  });
});
