import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyMetaWebhookSignature } from "@/lib/channels/meta-signature";

describe("Meta webhook signature verification", () => {
  const secret = "test-meta-app-secret";
  const body = '{"object":"instagram","entry":[]}';
  const signature = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;

  it("accepts the correct signature for the exact raw body", () => {
    expect(verifyMetaWebhookSignature(body, signature, secret)).toBe(true);
  });

  it("rejects altered bodies, missing headers, malformed digests and empty secrets", () => {
    expect(verifyMetaWebhookSignature(body + " ", signature, secret)).toBe(false);
    expect(verifyMetaWebhookSignature(body, null, secret)).toBe(false);
    expect(verifyMetaWebhookSignature(body, "sha256=bad", secret)).toBe(false);
    expect(verifyMetaWebhookSignature(body, signature, "")).toBe(false);
  });
});
