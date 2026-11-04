import { describe, expect, it } from "vitest";
import { isVerifiedSuperAdmin } from "@/lib/admin";

describe("isVerifiedSuperAdmin", () => {
  const allowlist = "owner@mobiwave.co.ke, security@mobiwave.co.ke";

  it("requires a verified email and an exact allowlisted address", () => {
    expect(isVerifiedSuperAdmin({ email: "owner@mobiwave.co.ke", emailVerified: true }, allowlist)).toBe(true);
    expect(isVerifiedSuperAdmin({ email: "OWNER@MOBIWAVE.CO.KE", emailVerified: true }, allowlist)).toBe(true);
  });

  it("rejects unverified, missing and non-allowlisted identities", () => {
    expect(isVerifiedSuperAdmin({ email: "owner@mobiwave.co.ke", emailVerified: false }, allowlist)).toBe(false);
    expect(isVerifiedSuperAdmin({ email: "owner@mobiwave.co.ke" }, allowlist)).toBe(false);
    expect(isVerifiedSuperAdmin({ email: "attacker@mobiwave.co.ke", emailVerified: true }, allowlist)).toBe(false);
    expect(isVerifiedSuperAdmin(null, allowlist)).toBe(false);
  });

  it("fails closed when the allowlist is empty", () => {
    expect(isVerifiedSuperAdmin({ email: "owner@mobiwave.co.ke", emailVerified: true }, "")).toBe(false);
  });
});
