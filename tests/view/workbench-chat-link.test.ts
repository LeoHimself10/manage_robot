import { afterEach, describe, expect, it } from "vitest";
import {
  appendWorkbenchChatLinkFooter,
  buildManagerChatDeepLink,
} from "../../src/view/workbench-chat-link";

describe("workbench-chat-link", () => {
  const prev = process.env.ASSIGNMENT_WEB_PUBLIC_BASE_URL;

  afterEach(() => {
    if (prev === undefined) delete process.env.ASSIGNMENT_WEB_PUBLIC_BASE_URL;
    else process.env.ASSIGNMENT_WEB_PUBLIC_BASE_URL = prev;
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
});
