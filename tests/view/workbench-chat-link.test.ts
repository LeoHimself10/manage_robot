import { afterEach, describe, expect, it } from "vitest";
import {
  appendWorkbenchChatLinkFooter,
  buildManagerChatDeepLink,
  buildManagerChatDeepLinkForDingtalkOutbound,
  normalizePublicPageUrl,
  toH5AppOpenPath,
  wrapUrlForDingtalkClient,
} from "../../src/view/workbench-chat-link";

describe("workbench-chat-link", () => {
  const prevBase = process.env.ASSIGNMENT_WEB_PUBLIC_BASE_URL;
  const prevCorp = process.env.DINGTALK_CORP_ID;
  const prevAgent = process.env.DINGTALK_AGENT_ID;
  const prevApplink = process.env.DINGTALK_WORKBENCH_APPLINK;
  const prevMode = process.env.DINGTALK_WORKBENCH_APPLINK_MODE;

  afterEach(() => {
    if (prevBase === undefined) delete process.env.ASSIGNMENT_WEB_PUBLIC_BASE_URL;
    else process.env.ASSIGNMENT_WEB_PUBLIC_BASE_URL = prevBase;
    if (prevCorp === undefined) delete process.env.DINGTALK_CORP_ID;
    else process.env.DINGTALK_CORP_ID = prevCorp;
    if (prevAgent === undefined) delete process.env.DINGTALK_AGENT_ID;
    else process.env.DINGTALK_AGENT_ID = prevAgent;
    if (prevApplink === undefined) delete process.env.DINGTALK_WORKBENCH_APPLINK;
    else process.env.DINGTALK_WORKBENCH_APPLINK = prevApplink;
    if (prevMode === undefined) delete process.env.DINGTALK_WORKBENCH_APPLINK_MODE;
    else process.env.DINGTALK_WORKBENCH_APPLINK_MODE = prevMode;
  });

  it("builds main thread chat URL when base configured", () => {
    process.env.ASSIGNMENT_WEB_PUBLIC_BASE_URL = "https://wb.example.com/";
    expect(buildManagerChatDeepLink({ threadKind: "main" })).toBe(
      "https://wb.example.com/workbench/manager/chat?thread=main",
    );
  });

  it("avoids double /workbench when base already ends with /workbench", () => {
    process.env.ASSIGNMENT_WEB_PUBLIC_BASE_URL = "https://wb.example.com/workbench";
    expect(buildManagerChatDeepLink({ threadKind: "main" })).toBe(
      "https://wb.example.com/workbench/manager/chat?thread=main",
    );
  });

  it("normalizePublicPageUrl collapses duplicate slashes in pathname", () => {
    expect(
      normalizePublicPageUrl("https://wb.example.com//workbench/manager/chat?thread=main"),
    ).toBe("https://wb.example.com/workbench/manager/chat?thread=main");
  });

  it("wrapUrlForDingtalkClient defaults to page/link even when corp/agent set", () => {
    process.env.DINGTALK_CORP_ID = "ding-corp";
    process.env.DINGTALK_AGENT_ID = "123456";
    delete process.env.DINGTALK_WORKBENCH_APPLINK_MODE;
    const page = "https://wb.example.com/workbench/manager/chat?thread=main&openDraftEditor=1";
    const wrapped = wrapUrlForDingtalkClient(page);
    expect(wrapped).toContain("https://applink.dingtalk.com/page/link?");
    expect(wrapped).toContain(encodeURIComponent(page));
    expect(wrapped).toContain("targetDesktop=workbench");
    expect(wrapped).not.toContain("h5_app_open");
  });

  it("toH5AppOpenPath strips /workbench prefix for optional h5 mode", () => {
    expect(
      toH5AppOpenPath(
        "https://wb.example.com/workbench/manager/chat?thread=main&openDraftEditor=1",
      ),
    ).toBe("manager/chat?thread=main&openDraftEditor=1");
  });

  it("wrapUrlForDingtalkClient uses h5_app_open only when mode=h5", () => {
    process.env.DINGTALK_CORP_ID = "ding-corp";
    process.env.DINGTALK_AGENT_ID = "123456";
    process.env.DINGTALK_WORKBENCH_APPLINK_MODE = "h5";
    const wrapped = wrapUrlForDingtalkClient(
      "https://wb.example.com/workbench/manager/chat?thread=main&openDraftEditor=1",
    );
    expect(wrapped).toContain("https://applink.dingtalk.com/page/h5_app_open?");
    expect(wrapped).toContain("path=manager%2Fchat");
  });

  it("buildManagerChatDeepLinkForDingtalkOutbound uses page/link by default", () => {
    process.env.ASSIGNMENT_WEB_PUBLIC_BASE_URL = "https://wb.example.com";
    process.env.DINGTALK_CORP_ID = "ding-corp";
    process.env.DINGTALK_AGENT_ID = "99";
    const link = buildManagerChatDeepLinkForDingtalkOutbound({ threadKind: "main" });
    expect(link).toContain("applink.dingtalk.com/page/link");
    expect(link).toContain(encodeURIComponent("openDraftEditor=1"));
  });

  it("appendWorkbenchChatLinkFooter adds markdown link", () => {
    const out = appendWorkbenchChatLinkFooter("hello", "https://wb.example.com/chat");
    expect(out).toContain("[在工作台继续编辑草案](https://wb.example.com/chat)");
  });
});
