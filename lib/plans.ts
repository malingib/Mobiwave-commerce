export type PlanLimits = {
  maxProducts?: number | null;
  maxDomains?: number | null;
  maxMembers?: number | null;
  includedEmailSendsPerMonth?: number | null;
  includedSmsSegmentsPerMonth?: number | null;
};

export function hasReachedPlanLimit(limit: unknown, currentCount: number) {
  return typeof limit === "number" && Number.isSafeInteger(limit) && limit >= 0 && currentCount >= limit;
}

export function isPermanentFreePlan(planCode: string) {
  return planCode === "free";
}

// Subscription entitlement is separate from store-level abuse/security suspension.
// Free never expires or enters dunning; paid plans require an active or trialing state.
export function canManagePaidFeatures(subscriptionStatus: string, planCode: string) {
  if (isPermanentFreePlan(planCode)) return true;
  return subscriptionStatus === "active" || subscriptionStatus === "trialing";
}

export function getIncludedAllowance(limits: PlanLimits | null | undefined, kind: "email" | "sms") {
  if (!limits) return 0;
  const value = kind === "email" ? limits.includedEmailSendsPerMonth : limits.includedSmsSegmentsPerMonth;
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}
