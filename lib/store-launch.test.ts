import { describe, expect, it } from "@/lib/test-runtime";
import { evaluateStoreLaunch, isValidKenyanBusinessPhone } from "@/lib/store-launch";

describe("store launch readiness", () => {
  const ready = {
    emailVerified: true,
    contactPhone: "+254712345678",
    businessCategory: "general_retail",
    businessDescription: "We sell quality household products across Kenya.",
    activeProductCount: 1,
  };

  it("auto-approves complete low-risk stores", () => {
    expect(evaluateStoreLaunch(ready)).toEqual({ decision: "auto_approve", missing: [], riskFlags: [] });
  });

  it("keeps incomplete stores in draft and returns actionable checklist items", () => {
    expect(evaluateStoreLaunch({ ...ready, emailVerified: false, contactPhone: null, activeProductCount: 0 })).toEqual({
      decision: "incomplete",
      missing: [
        "Verify the account email address",
        "Add a valid Kenyan business phone number",
        "Publish at least one product",
      ],
      riskFlags: [],
    });
  });

  it("routes regulated and uncategorized businesses to manual review", () => {
    expect(evaluateStoreLaunch({ ...ready, businessCategory: "regulated" })).toMatchObject({
      decision: "manual_review",
      riskFlags: ["regulated_business_category"],
    });
    expect(evaluateStoreLaunch({ ...ready, businessCategory: "other" })).toMatchObject({
      decision: "manual_review",
      riskFlags: ["uncategorized_business_category"],
    });
  });

  it("requires a meaningful business description", () => {
    expect(evaluateStoreLaunch({ ...ready, businessDescription: "Short" })).toMatchObject({
      decision: "incomplete",
      missing: ["Add a business description of at least 30 characters"],
    });
  });

  it("accepts common Kenyan phone formats and rejects malformed numbers", () => {
    for (const phone of ["+254712345678", "254712345678", "0712345678", "0712 345 678"]) {
      expect(isValidKenyanBusinessPhone(phone)).toBe(true);
    }
    for (const phone of ["+254123", "071234567", "abc", null]) {
      expect(isValidKenyanBusinessPhone(phone)).toBe(false);
    }
  });
});
