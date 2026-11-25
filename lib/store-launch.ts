export const STORE_BUSINESS_CATEGORIES = [
  "general_retail",
  "food_beverage",
  "beauty",
  "fashion",
  "electronics",
  "home_living",
  "services",
  "digital_goods",
  "regulated",
  "other",
] as const;

export type StoreBusinessCategory = typeof STORE_BUSINESS_CATEGORIES[number];

export type StoreLaunchInput = {
  emailVerified: boolean;
  contactPhone: string | null;
  businessCategory: string;
  businessDescription: string;
  activeProductCount: number;
};

export type StoreLaunchDecision =
  | { decision: "incomplete"; missing: string[]; riskFlags: string[] }
  | { decision: "manual_review"; missing: []; riskFlags: string[] }
  | { decision: "auto_approve"; missing: []; riskFlags: [] };

export function isValidKenyanBusinessPhone(value: string | null) {
  if (!value) return false;
  const normalized = value.replace(/[\s()-]/g, "");
  return /^(?:\+254|254|0)?[17]\d{8}$/.test(normalized);
}

export function evaluateStoreLaunch(input: StoreLaunchInput): StoreLaunchDecision {
  const missing: string[] = [];
  if (!input.emailVerified) missing.push("Verify the account email address");
  if (!isValidKenyanBusinessPhone(input.contactPhone)) missing.push("Add a valid Kenyan business phone number");
  if (input.businessDescription.trim().length < 30) missing.push("Add a business description of at least 30 characters");
  if (!Number.isInteger(input.activeProductCount) || input.activeProductCount < 1) missing.push("Publish at least one product");

  const category = STORE_BUSINESS_CATEGORIES.includes(input.businessCategory as StoreBusinessCategory)
    ? input.businessCategory
    : "other";
  const riskFlags = category === "regulated"
    ? ["regulated_business_category"]
    : category === "other"
      ? ["uncategorized_business_category"]
      : [];

  if (missing.length) return { decision: "incomplete", missing, riskFlags };
  if (riskFlags.length) return { decision: "manual_review", missing: [], riskFlags };
  return { decision: "auto_approve", missing: [], riskFlags: [] };
}
