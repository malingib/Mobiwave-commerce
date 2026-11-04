import { describe, expect, it } from "vitest";
import { canManagePaidFeatures, hasReachedPlanLimit } from "@/lib/plans";

describe("plan enforcement", () => {
  it("treats an unset limit as unlimited and enforces configured quotas", () => {
    expect(hasReachedPlanLimit(undefined, 1000)).toBe(false);
    expect(hasReachedPlanLimit(null, 1000)).toBe(false);
    expect(hasReachedPlanLimit(10, 9)).toBe(false);
    expect(hasReachedPlanLimit(10, 10)).toBe(true);
    expect(hasReachedPlanLimit(0, 0)).toBe(true);
  });

  it("keeps free plans available and restricts delinquent paid plans", () => {
    expect(canManagePaidFeatures("cancelled", "free")).toBe(true);
    expect(canManagePaidFeatures("active", "growth")).toBe(true);
    expect(canManagePaidFeatures("trialing", "pro")).toBe(true);
    expect(canManagePaidFeatures("past_due", "growth")).toBe(false);
    expect(canManagePaidFeatures("cancelled", "business")).toBe(false);
  });
});
