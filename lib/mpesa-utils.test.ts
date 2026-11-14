import { describe, expect, it } from "vitest";
import { formatDarajaTimestamp, matchesKenyanPhone, normalizeKenyanPhone } from "@/lib/mpesa-utils";

describe("Kenyan phone normalization", () => {
  it.each([
    ["0712345678", "254712345678"],
    ["254712345678", "254712345678"],
    ["712345678", "254712345678"],
    ["0112345678", "254112345678"],
    ["112345678", "254112345678"],
  ])("normalizes %s", (input, expected) => {
    expect(normalizeKenyanPhone(input)).toBe(expected);
  });

  it("rejects malformed numbers and compares normalized callback phone numbers", () => {
    expect(normalizeKenyanPhone("123")).toBeNull();
    expect(matchesKenyanPhone("+254 712 345 678", "0712345678")).toBe(true);
    expect(matchesKenyanPhone("0712345678", "0712345679")).toBe(false);
  });
});

describe("Daraja timestamp", () => {
  it("formats the supplied instant in Africa/Nairobi time regardless of host timezone", () => {
    expect(formatDarajaTimestamp(new Date("2026-11-04T16:00:00.000Z"))).toBe("20261104190000");
  });
});
