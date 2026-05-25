import { describe, expect, it } from "vitest";
import {
  hashExternalAccountPassword,
  verifyExternalAccountPassword,
} from "../../src/infra/external-account-password";

describe("external-account-password", () => {
  it("hashes and verifies password", () => {
    const hash = hashExternalAccountPassword("secret-pass-123");
    expect(hash.startsWith("scrypt$")).toBe(true);
    expect(verifyExternalAccountPassword("secret-pass-123", hash)).toBe(true);
    expect(verifyExternalAccountPassword("wrong", hash)).toBe(false);
  });
});
