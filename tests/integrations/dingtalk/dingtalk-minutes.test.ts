import { afterEach, describe, expect, it, vi } from "vitest";
import { createDingTalkMinutesClient } from "../../../src/integrations/dingtalk/dingtalk-minutes";

describe("DingTalk AI Minutes DWS client", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("lists all accessible minutes with the manager's isolated OAuth profile", async () => {
    vi.stubEnv("DINGTALK_MINUTES_DWS_ENABLED", "1");
    vi.stubEnv("DINGTALK_MINUTES_DWS_PATH", "/usr/local/bin/dws");
    vi.stubEnv("DINGTALK_MINUTES_DWS_HOME", "/profiles/manager-a");
    vi.stubEnv("DINGTALK_MINUTES_DWS_MANAGER_USER_IDS", "manager-a");
    const calls: Array<{ args: string[]; home?: string }> = [];
    const client = createDingTalkMinutesClient({
      runCommand: async (input) => {
        calls.push({ args: input.args, home: input.env.HOME });
        return JSON.stringify({
          result: {
            minutesDetails: [
              {
                taskUuid: "task-1",
                title: "临时碰头",
                creatorUnionId: "union-a",
                startTime: 1_721_000_000_000,
                durationMicros: 120_000_000,
                status: "FINISHED",
              },
            ],
          },
        });
      },
    });

    const result = await client.listAccessible({
      managerUserId: "manager-a",
      startTimeMs: 1_720_000_000_000,
      endTimeMs: 1_722_000_000_000,
    });

    expect(result).toEqual([
      expect.objectContaining({
        taskUuid: "task-1",
        title: "临时碰头",
        durationMs: 120_000,
      }),
    ]);
    expect(calls[0]?.args.slice(0, 4)).toEqual(["minutes", "list", "all", "--start"]);
    expect(calls[0]?.args).toContain("--limit");
    expect(calls[0]?.args).toContain("--format");
    expect(calls[0]?.home).toBe("/profiles/manager-a");
  });

  it("follows transcription nextToken until the complete transcript is cached", async () => {
    vi.stubEnv("DINGTALK_MINUTES_DWS_ENABLED", "1");
    vi.stubEnv("DINGTALK_MINUTES_DWS_PATH", "/usr/local/bin/dws");
    vi.stubEnv("DINGTALK_MINUTES_DWS_HOME", "/profiles/manager-a");
    vi.stubEnv("DINGTALK_MINUTES_DWS_MANAGER_USER_IDS", "manager-a");
    let page = 0;
    const calls: string[][] = [];
    const client = createDingTalkMinutesClient({
      now: () => Date.parse("2026-07-24T04:00:00.000Z"),
      runCommand: async (input) => {
        calls.push(input.args);
        page += 1;
        return page === 1
          ? JSON.stringify({
              result: {
                paragraphs: [{ speakerNick: "Manager", text: "先整理需求" }],
                nextToken: "page-2",
              },
            })
          : JSON.stringify({
              result: {
                paragraphs: [{ speakerNick: "Employee", text: "再确认排期" }],
              },
            });
      },
    });

    const result = await client.getTranscription({
      managerUserId: "manager-a",
      taskUuid: "task-1",
    });

    expect(page).toBe(2);
    expect(calls[1]).toEqual(expect.arrayContaining(["--cursor", "page-2"]));
    expect(result).toEqual({
      taskUuid: "task-1",
      text: "Manager: 先整理需求\nEmployee: 再确认排期",
      fetchedAt: "2026-07-24T04:00:00.000Z",
    });
  });
});
