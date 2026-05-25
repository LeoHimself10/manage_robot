import { describe, expect, it } from "vitest";
import {
  buildExternalLoginUrl,
  readExternalLoginNextFromUrl,
  resolveWorkbenchSessionExpiredRedirect,
  sanitizeWorkbenchNextPath,
} from "../../src/web/external-workbench-login";

describe("external-workbench-login helpers", () => {
  it("sanitizeWorkbenchNextPath accepts employee paths only", () => {
    expect(sanitizeWorkbenchNextPath("/workbench/employee?view=new")).toBe(
      "/workbench/employee?view=new",
    );
    expect(sanitizeWorkbenchNextPath("/workbench/manager/tasks")).toBeUndefined();
    expect(sanitizeWorkbenchNextPath("https://evil.example/x")).toBeUndefined();
  });

  it("buildExternalLoginUrl encodes next query", () => {
    expect(buildExternalLoginUrl("/workbench/employee?view=current")).toBe(
      "/workbench/external/login?next=%2Fworkbench%2Femployee%3Fview%3Dcurrent",
    );
  });

  it("readExternalLoginNextFromUrl falls back to employee home", () => {
    expect(readExternalLoginNextFromUrl("?next=%2Fworkbench%2Femployee%3Fview%3Dhistory")).toBe(
      "/workbench/employee?view=history",
    );
    expect(readExternalLoginNextFromUrl("?next=/workbench/manager/tasks")).toBe(
      "/workbench/employee?view=new",
    );
  });

  it("resolveWorkbenchSessionExpiredRedirect branches on loginSource", () => {
    expect(resolveWorkbenchSessionExpiredRedirect("external_password", "/workbench/employee?view=new"))
      .toContain("/workbench/external/login?next=");
    expect(resolveWorkbenchSessionExpiredRedirect("dingtalk_authcode")).toBe("/workbench");
  });
});
