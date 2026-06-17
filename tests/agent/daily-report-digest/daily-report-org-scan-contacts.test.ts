import { describe, expect, it, vi } from "vitest";

import {
  isBotLikeContactName,
  listOrgScanContacts,
} from "../../../src/agent/daily-report-digest/daily-report-org-scan-contacts";

describe("daily-report-org-scan-contacts", () => {
  it("isBotLikeContactName matches robot and T- prefixes", () => {
    expect(isBotLikeContactName("任务机器人")).toBe(true);
    expect(isBotLikeContactName("T-助手")).toBe(true);
    expect(isBotLikeContactName("张三")).toBe(false);
  });

  it("listOrgScanContacts uses org DingTalk directory and excludes bots", async () => {
    const directory = {
      listAll: vi.fn(async () => [
        { userid: "u1", name: "Alice", departments: [] },
        { userid: "u2", name: "任务机器人", departments: [] },
      ]),
      search: vi.fn(),
      invalidate: vi.fn(),
    };

    const contacts = await listOrgScanContacts(
      { label: "微光", appKey: "k", appSecret: "s" },
      { directory: directory as any },
    );

    expect(directory.listAll).toHaveBeenCalledWith("k", "s", 5000);
    expect(contacts).toEqual([{ userid: "u1", name: "Alice" }]);
  });

  it("throws when org credentials missing", async () => {
    await expect(
      listOrgScanContacts({ label: "微光", appKey: "", appSecret: "" }),
    ).rejects.toThrow(/缺少 appKey/);
  });
});
