import { describe, expect, it } from "@/lib/test-runtime";
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

import { canonicalHostname, isApexHostname } from "@/lib/domains";

describe("custom domain canonical host selection", () => {
  it("prefers www for apex domains including common Kenyan public suffixes", () => {
    expect(isApexHostname("example.com")).toBe(true);
    expect(isApexHostname("example.co.ke")).toBe(true);
    expect(canonicalHostname("example.co.ke")).toBe("www.example.co.ke");
  });

  it("does not add www to an existing subdomain", () => {
    expect(isApexHostname("shop.example.com")).toBe(false);
    expect(canonicalHostname("shop.example.com")).toBe("shop.example.com");
  });
});
