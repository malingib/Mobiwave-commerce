import { describe, expect, it } from "@/lib/test-runtime";
import { canManagePaidFeatures, getIncludedAllowance, hasReachedPlanLimit, isPermanentFreePlan } from "@/lib/plans";

describe("plan enforcement", () => {
  it("treats an unset limit as unlimited and enforces configured quotas", () => {
    expect(hasReachedPlanLimit(undefined, 1000)).toBe(false);
    expect(hasReachedPlanLimit(null, 1000)).toBe(false);
    expect(hasReachedPlanLimit(10, 9)).toBe(false);
    expect(hasReachedPlanLimit(10, 10)).toBe(true);
    expect(hasReachedPlanLimit(0, 0)).toBe(true);
  });

  it("keeps Free permanent and outside paid-plan dunning", () => {
    expect(isPermanentFreePlan("free")).toBe(true);
    expect(isPermanentFreePlan("starter")).toBe(false);
    expect(canManagePaidFeatures("active", "free")).toBe(true);
    expect(canManagePaidFeatures("past_due", "free")).toBe(true);
    expect(canManagePaidFeatures("suspended", "free")).toBe(true);
  });

  it("retains paid entitlements during Day 0-2 recovery and restricts after suspension", () => {
    expect(canManagePaidFeatures("active", "growth")).toBe(true);
    expect(canManagePaidFeatures("trialing", "professional")).toBe(true);
    expect(canManagePaidFeatures("past_due", "growth")).toBe(true);
    expect(canManagePaidFeatures("suspended", "business")).toBe(false);
    expect(canManagePaidFeatures("cancelled", "starter")).toBe(false);
    expect(canManagePaidFeatures("expired", "enterprise")).toBe(false);
  });

  it("returns the configured included email and SMS allowances", () => {
    const limits = { includedEmailSendsPerMonth: 30, includedSmsSegmentsPerMonth: 30 };
    expect(getIncludedAllowance(limits, "email")).toBe(30);
    expect(getIncludedAllowance(limits, "sms")).toBe(30);
    expect(getIncludedAllowance(undefined, "email")).toBe(0);
    expect(getIncludedAllowance({ includedSmsSegmentsPerMonth: null }, "sms")).toBe(0);
  });
});
