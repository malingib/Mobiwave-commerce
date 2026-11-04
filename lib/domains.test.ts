import { describe, expect, it } from "vitest";
import { domainVerificationRecordName, domainVerificationRecordValue, normalizeCustomHostname } from "@/lib/domains";

describe("custom domain validation", () => {
  const root = "shop.mobiwave.co.ke";

  it("normalizes valid hostnames and internationalized domains", () => {
    expect(normalizeCustomHostname(" Shop.Example.com. ", root)).toBe("shop.example.com");
    expect(normalizeCustomHostname("münchen.example", root)).toBe("xn--mnchen-3ya.example");
  });

  it("rejects URLs, paths, ports, IP addresses and platform-owned hosts", () => {
    for (const value of [
      "https://example.com",
      "example.com/path",
      "example.com:443",
      "127.0.0.1",
      "shop.mobiwave.co.ke",
      "store.shop.mobiwave.co.ke",
      "wap.mobiwave.co.ke",
      "mobiwave-commerce.vercel.app",
    ]) expect(normalizeCustomHostname(value, root)).toBeNull();
  });

  it("generates deterministic DNS verification records", () => {
    expect(domainVerificationRecordName("shop.example.com")).toBe("_mobiwave-commerce.shop.example.com");
    expect(domainVerificationRecordValue("abc123")).toBe("mobiwave-commerce-verification=abc123");
  });
});
