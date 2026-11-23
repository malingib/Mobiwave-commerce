import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { validateProviderConfig } from "@/lib/platform-provider-config";

describe("platform provider configuration validation", () => {
  it("rejects missing provider credentials before persistence", () => {
    assert.throws(() => validateProviderConfig("mobiwave_sms", { apiUrl: "https://sms.example.test/api", apiKey: "", senderId: "MOBIWAVE" }), /missing_apiKey/);
  });

  it("rejects insecure provider endpoints", () => {
    assert.throws(() => validateProviderConfig("r2", {
      accountId: "a".repeat(32), endpoint: "http://abc.r2.cloudflarestorage.com",
      bucketName: "mobiwave-media", accessKeyId: "key", secretAccessKey: "secret",
    }), /r2_endpoint_rejected/);
  });

  it("accepts complete HTTPS SMS and Meta application configuration", () => {
    assert.doesNotThrow(() => validateProviderConfig("mobiwave_sms", {
      apiUrl: "https://sms.mobiwave.co.ke/api/v3", apiKey: "private-key", senderId: "MOBIWAVE",
    }));
    assert.doesNotThrow(() => validateProviderConfig("meta", {
      appId: "123456789", appSecret: "private-secret", whatsappConfigId: "config-123",
      graphVersion: "v27.0", instagramRedirectUri: "https://commerce.example.test/api/oauth/meta/instagram/callback",
      webhookVerifyToken: "private-webhook-token",
    }));
  });

  it("rejects arbitrary SMS hosts and private scanner targets", () => {
    assert.throws(() => validateProviderConfig("mobiwave_sms", { apiUrl: "https://example.test/api", apiKey: "key", senderId: "MOBIWAVE" }), /sms_api_endpoint_rejected/);
    assert.throws(() => validateProviderConfig("media_scanner", { provider: "custom", scannerUrl: "https://127.0.0.1/scan", scannerToken: "token" }), /scanner_url_rejected/);
  });

  it("rejects sender IDs that exceed the provider limit", () => {
    assert.throws(() => validateProviderConfig("mobiwave_sms", {
      apiUrl: "https://sms.mobiwave.co.ke/api/v3", apiKey: "key", senderId: "MOBIWAVE-STORE",
    }), /sms_sender_id_too_long/);
  });
});
