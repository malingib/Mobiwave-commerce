import { describe, expect, it } from "vitest";
import { isVerifiedSuperAdmin, matchesKenyanPhone, normalizeKenyanPhone } from "../lib/security";

describe("isVerifiedSuperAdmin", () => {
  it("rejects an allowlisted but unverified email", () => {
    expect(isVerifiedSuperAdmin("admin@example.com", false, "admin@example.com")).toBe(false);
  });
  it("accepts a verified email on the normalized allowlist", () => {
    expect(isVerifiedSuperAdmin(" Admin@Example.com ", true, "admin@example.com, owner@example.com")).toBe(true);
  });
  it("rejects emails that are not allowlisted", () => {
    expect(isVerifiedSuperAdmin("other@example.com", true, "admin@example.com")).toBe(false);
  });
  it("rejects an empty allowlist", () => {
    expect(isVerifiedSuperAdmin("admin@example.com", true, "")).toBe(false);
  });
});

describe("normalizeKenyanPhone", () => {
  it.each([
    ["0712345678", "254712345678"],
    ["254712345678", "254712345678"],
    ["712345678", "254712345678"],
    ["0112345678", "254112345678"],
    [254712345678, "254712345678"],
  ])("normalizes %s", (input, expected) => {
    expect(normalizeKenyanPhone(input)).toBe(expected);
  });
  it.each(["123", "25471234567", "9999999999", "abcdefghij", ""])("rejects invalid number %s", (input) => {
    expect(normalizeKenyanPhone(input)).toBeNull();
  });
});

describe("matchesKenyanPhone", () => {
  it("matches equivalent local and international formats", () => {
    expect(matchesKenyanPhone("0712345678", 254712345678)).toBe(true);
  });
  it("rejects a different customer phone", () => {
    expect(matchesKenyanPhone("0712345678", "0722345678")).toBe(false);
  });
  it("rejects missing or malformed phone metadata", () => {
    expect(matchesKenyanPhone("0712345678", null)).toBe(false);
    expect(matchesKenyanPhone("invalid", "0712345678")).toBe(false);
  });
});
