import { afterEach, describe, expect, it } from "vitest";
import {
  appendWorkbenchChatLinkFooter,
  buildManagerChatDeepLink,
  buildManagerChatDeepLinkForDingtalkOutbound,
  wrapUrlForDingtalkClient,
} from "../../src/view/workbench-chat-link";

describe("workbench-chat-link", () => {
  const prevBase = process.env.ASSIGNMENT_WEB_PUBLIC_BASE_URL;
  const prevCorp = process.env.DINGTALK_CORP_ID;
  const prevAgent = process.env.DINGTALK_AGENT_ID;
  const prevApplink = process.env.DINGTALK_WORKBENCH_APPLINK;

  afterEach(() => {
    if (prevBase === undefined) delete process.env.ASSIGNMENT_WEB_PUBLIC_BASE_URL;
    else process.env.ASSIGNMENT_WEB_PUBLIC_BASE_URL = prevBase;
    if (prevCorp === undefined) delete process.env.DINGTALK_CORP_ID;
    else process.env.DINGTALK_CORP_ID = prevCorp;
    if (prevAgent === undefined) delete process.env.DINGTALK_AGENT_ID;
    else process.env.DINGTALK_AGENT_ID = prevAgent;
    if (prevApplink === undefined) delete process.env.DINGTALK_WORKBENCH_APPLINK;
    else process.env.DINGTALK_WORKBENCH_APPLINK = prevApplink;
  });

  it("builds main thread chat URL when base configured", () => {
    process.env.ASSIGNMENT_WEB_PUBLIC_BASE_URL = "https://wb.example.com/";
    expect(buildManagerChatDeepLink({ threadKind: "main" })).toBe(
      "https://wb.example.com/workbench/manager/chat?thread=main",
    );
  });

  it("builds side thread chat URL", () => {
    process.env.ASSIGNMENT_WEB_PUBLIC_BASE_URL = "https://wb.example.com";
    expect(buildManagerChatDeepLink({ threadId: "abc-123", threadKind: "side" })).toBe(
      "https://wb.example.com/workbench/manager/chat?thread=side&threadId=abc-123",
    );
  });

  it("appendWorkbenchChatLinkFooter adds markdown link", () => {
    const out = appendWorkbenchChatLinkFooter("hello", "https://wb.example.com/chat");
    expect(out).toContain("[在工作台继续编辑草案](https://wb.example.com/chat)");
  });

  it("wrapUrlForDingtalkClient uses h5_app_open when corp and agent configured", () => {
    process.env.DINGTALK_CORP_ID = "ding-corp";
    process.env.DINGTALK_AGENT_ID = "123456";
    const wrapped = wrapUrlForDingtalkClient(
      "https://wb.example.com/workbench/manager/chat?thread=main&openDraftEditor=1",
    );
    expect(wrapped).toContain("https://applink.dingtalk.com/page/h5_app_open?");
    expect(wrapped).toContain("appId=123456");
    expect(wrapped).toContain("corpId=ding-corp");
    expect(wrapped).toContain("appType=2");
    expect(wrapped).toContain(
      encodeURIComponent("/workbench/manager/chat?thread=main&openDraftEditor=1"),
    );
  });

  it("wrapUrlForDingtalkClient falls back to page/link without corp/agent", () => {
    delete process.env.DINGTALK_CORP_ID;
    delete process.env.DINGTALK_AGENT_ID;
    const page = "https://wb.example.com/workbench/manager/chat?thread=main";
    expect(wrapUrlForDingtalkClient(page)).toBe(
      `https://applink.dingtalk.com/page/link?url=${encodeURIComponent(page)}&target=fullScreen&targetDesktop=workbench`,
    );
  });

  it("buildManagerChatDeepLinkForDingtalkOutbound adds openDraftEditor and applink", () => {
    process.env.ASSIGNMENT_WEB_PUBLIC_BASE_URL = "https://wb.example.com";
    process.env.DINGTALK_CORP_ID = "ding-corp";
    process.env.DINGTALK_AGENT_ID = "99";
    const link = buildManagerChatDeepLinkForDingtalkOutbound({ threadKind: "main" });
    expect(link).toContain("applink.dingtalk.com/page/h5_app_open");
    expect(link).toContain(encodeURIComponent("openDraftEditor=1"));
  });
});
