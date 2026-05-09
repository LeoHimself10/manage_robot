import { afterEach, describe, expect, it, vi } from "vitest";
import {
  resolveAssignmentDraftDir,
  resolveEmployeeProfileDir,
  resolveEmployeeFixtureSourcePath,
  resolveAssignmentEventsPath,
  resolveCardCallbacksPath,
  resolveCardStateDir,
  resolveAssignmentWebSecret,
  resolveAssignmentWebPort,
  resolveAssignmentWebPublicBaseUrl,
  isDingtalkAssignmentMock,
} from "../../src/infra/assignment-env";

describe("assignment-env", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe("resolveAssignmentDraftDir", () => {
    it("defaults to ./data/plans", () => {
      vi.stubEnv("ASSIGNMENT_DRAFT_DIR", undefined);
      expect(resolveAssignmentDraftDir()).toBe("./data/plans");
    });

    it("reads from env when set", () => {
      vi.stubEnv("ASSIGNMENT_DRAFT_DIR", "/custom/drafts");
      expect(resolveAssignmentDraftDir()).toBe("/custom/drafts");
    });
  });

  describe("resolveEmployeeProfileDir", () => {
    it("defaults to ./data/employees/profiles", () => {
      vi.stubEnv("EMPLOYEE_PROFILE_DIR", undefined);
      expect(resolveEmployeeProfileDir()).toBe("./data/employees/profiles");
    });

    it("reads from env when set", () => {
      vi.stubEnv("EMPLOYEE_PROFILE_DIR", "/custom/profiles");
      expect(resolveEmployeeProfileDir()).toBe("/custom/profiles");
    });
  });

  describe("resolveEmployeeFixtureSourcePath", () => {
    it("reads from env when set", () => {
      vi.stubEnv("EMPLOYEE_FIXTURE_SOURCE", "/custom/seed.json");
      expect(resolveEmployeeFixtureSourcePath()).toBe("/custom/seed.json");
    });

    it("defaults to a path under repo fixtures", () => {
      vi.stubEnv("EMPLOYEE_FIXTURE_SOURCE", undefined);
      const p = resolveEmployeeFixtureSourcePath();
      expect(p).toContain("fixtures");
      expect(p).toContain("employees-seed.json");
    });
  });

  describe("resolveAssignmentEventsPath", () => {
    it("defaults to ./data/events/assignment-events.jsonl", () => {
      vi.stubEnv("ASSIGNMENT_EVENTS_PATH", undefined);
      expect(resolveAssignmentEventsPath()).toBe("./data/events/assignment-events.jsonl");
    });
  });

  describe("resolveCardCallbacksPath", () => {
    it("defaults to ./data/events/card-callbacks.jsonl", () => {
      vi.stubEnv("CARD_CALLBACKS_PATH", undefined);
      expect(resolveCardCallbacksPath()).toBe("./data/events/card-callbacks.jsonl");
    });
  });

  describe("resolveCardStateDir", () => {
    it("defaults to ./data/cards", () => {
      vi.stubEnv("CARD_STATE_DIR", undefined);
      expect(resolveCardStateDir()).toBe("./data/cards");
    });
  });

  describe("resolveAssignmentWebSecret", () => {
    it("throws when not set", () => {
      vi.stubEnv("ASSIGNMENT_WEB_SECRET", undefined);
      expect(() => resolveAssignmentWebSecret()).toThrow("ASSIGNMENT_WEB_SECRET");
    });

    it("returns trimmed value when set", () => {
      vi.stubEnv("ASSIGNMENT_WEB_SECRET", "  my-secret-key-32-chars-minimum  ");
      expect(resolveAssignmentWebSecret()).toBe("my-secret-key-32-chars-minimum");
    });
  });

  describe("resolveAssignmentWebPort", () => {
    it("defaults to 8787", () => {
      vi.stubEnv("ASSIGNMENT_WEB_PORT", undefined);
      expect(resolveAssignmentWebPort()).toBe(8787);
    });

    it("reads from env when set", () => {
      vi.stubEnv("ASSIGNMENT_WEB_PORT", "3000");
      expect(resolveAssignmentWebPort()).toBe(3000);
    });

    it("falls back to 8787 on invalid input", () => {
      vi.stubEnv("ASSIGNMENT_WEB_PORT", "not-a-number");
      expect(resolveAssignmentWebPort()).toBe(8787);
      vi.stubEnv("ASSIGNMENT_WEB_PORT", "-5");
      expect(resolveAssignmentWebPort()).toBe(8787);
      vi.stubEnv("ASSIGNMENT_WEB_PORT", "0");
      expect(resolveAssignmentWebPort()).toBe(8787);
    });
  });

  describe("resolveAssignmentWebPublicBaseUrl", () => {
    it("throws when not set", () => {
      vi.stubEnv("ASSIGNMENT_WEB_PUBLIC_BASE_URL", undefined);
      expect(() => resolveAssignmentWebPublicBaseUrl()).toThrow("ASSIGNMENT_WEB_PUBLIC_BASE_URL");
    });

    it("strips trailing slash", () => {
      vi.stubEnv("ASSIGNMENT_WEB_PUBLIC_BASE_URL", "https://bot.example.com/");
      expect(resolveAssignmentWebPublicBaseUrl()).toBe("https://bot.example.com");
    });

    it("returns as-is when no trailing slash", () => {
      vi.stubEnv("ASSIGNMENT_WEB_PUBLIC_BASE_URL", "https://bot.example.com");
      expect(resolveAssignmentWebPublicBaseUrl()).toBe("https://bot.example.com");
    });
  });

  describe("isDingtalkAssignmentMock", () => {
    it("defaults false", () => {
      vi.stubEnv("DINGTALK_ASSIGNMENT_MOCK", undefined);
      expect(isDingtalkAssignmentMock()).toBe(false);
    });

    it("parses truthy values", () => {
      vi.stubEnv("DINGTALK_ASSIGNMENT_MOCK", "1");
      expect(isDingtalkAssignmentMock()).toBe(true);
      vi.stubEnv("DINGTALK_ASSIGNMENT_MOCK", "true");
      expect(isDingtalkAssignmentMock()).toBe(true);
      vi.stubEnv("DINGTALK_ASSIGNMENT_MOCK", "yes");
      expect(isDingtalkAssignmentMock()).toBe(true);
      vi.stubEnv("DINGTALK_ASSIGNMENT_MOCK", "TRUE");
      expect(isDingtalkAssignmentMock()).toBe(true);
    });

    it("parses falsy values", () => {
      vi.stubEnv("DINGTALK_ASSIGNMENT_MOCK", "0");
      expect(isDingtalkAssignmentMock()).toBe(false);
      vi.stubEnv("DINGTALK_ASSIGNMENT_MOCK", "false");
      expect(isDingtalkAssignmentMock()).toBe(false);
      vi.stubEnv("DINGTALK_ASSIGNMENT_MOCK", "no");
      expect(isDingtalkAssignmentMock()).toBe(false);
    });
  });
});
