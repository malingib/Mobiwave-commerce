import { describe, expect, it } from "@/lib/test-runtime";
import { isPublicAddress, isVercelDnsTarget } from "@/lib/domain-readiness";

describe("custom domain readiness checks", () => {
  it("blocks private, loopback and reserved IP ranges", () => {
    for (const ip of ["127.0.0.1","10.0.0.1","172.16.0.1","192.168.1.2","169.254.1.1","100.64.0.1","224.0.0.1","::1","fc00::1","fe80::1"]) {
      expect(isPublicAddress(ip)).toBe(false);
    }
  });

  it("accepts public IPv4 and IPv6 addresses", () => {
    expect(isPublicAddress("76.76.21.21")).toBe(true);
    expect(isPublicAddress("2606:4700:4700::1111")).toBe(true);
  });

  it("recognizes Vercel's supported CNAME and A records", () => {
    expect(isVercelDnsTarget(["cname.vercel-dns.com."], [])).toBe(true);
    expect(isVercelDnsTarget([], ["76.76.21.21"])).toBe(true);
    expect(isVercelDnsTarget(["example.net"], ["203.0.113.10"])).toBe(false);
  });
});
