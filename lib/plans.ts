export type PlanLimits = {
  maxProducts?: number | null;
  maxDomains?: number | null;
  maxMembers?: number | null;
};

export function hasReachedPlanLimit(limit: unknown, currentCount: number) {
  return typeof limit === "number" && Number.isSafeInteger(limit) && limit >= 0 && currentCount >= limit;
}

export function canManagePaidFeatures(subscriptionStatus: string, planCode: string) {
  return planCode === "free" || subscriptionStatus === "active" || subscriptionStatus === "trialing";
}
