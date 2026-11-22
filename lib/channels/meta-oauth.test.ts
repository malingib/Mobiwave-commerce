import { afterEach, describe, expect, it, vi } from "@/lib/test-runtime";
import {
  buildInstagramAuthorizationUrl,
  exchangeWhatsAppEmbeddedSignupCode,
  getWhatsAppPhoneNumber,
} from "@/lib/channels/meta-oauth";

const original = {
  appId: process.env.META_APP_ID,
  appSecret: process.env.META_APP_SECRET,
  graphVersion: process.env.META_GRAPH_API_VERSION,
};

afterEach(() => {
  for (const [key, value] of [
    ["META_APP_ID", original.appId],
    ["META_APP_SECRET", original.appSecret],
    ["META_GRAPH_API_VERSION", original.graphVersion],
  ] as const) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  vi.unstubAllGlobals();
});

describe("Meta onboarding clients", () => {
  it("builds Instagram Login with only the requested messaging permissions", () => {
    process.env.META_APP_ID = "meta-app-123";
    const url = new URL(buildInstagramAuthorizationUrl("random-state", "https://shop.example/api/oauth/meta/instagram/callback"));
    expect(url.origin).toBe("https://www.instagram.com");
    expect(url.pathname).toBe("/oauth/authorize");
    expect(url.searchParams.get("client_id")).toBe("meta-app-123");
    expect(url.searchParams.get("state")).toBe("random-state");
    expect(url.searchParams.get("scope")).toBe("instagram_business_basic,instagram_business_manage_messages");
  });

  it("exchanges the WhatsApp Embedded Signup code only on the server", async () => {
    process.env.META_APP_ID = "meta-app-123";
    process.env.META_APP_SECRET = "server-only-secret";
    process.env.META_GRAPH_API_VERSION = "v27.0";
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      access_token: "server-access-token",
      token_type: "bearer",
      expires_in: 3600,
      permissions: ["whatsapp_business_management", "whatsapp_business_messaging"],
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const token = await exchangeWhatsAppEmbeddedSignupCode("one-time-code");
    expect(token.accessToken).toBe("server-access-token");
    expect(token.expiresIn).toBe(3600);
    const requested = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(requested.searchParams.get("client_secret")).toBe("server-only-secret");
    expect(requested.searchParams.get("code")).toBe("one-time-code");
  });

  it("verifies that the selected WhatsApp phone number belongs to the returned WABA", async () => {
    const fetchMock = vi.fn().mockImplementation(async () => new Response(JSON.stringify({
      data: [
        { id: "phone-1", display_phone_number: "+254700000001", verified_name: "Merchant One" },
      ],
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(getWhatsAppPhoneNumber("waba-1", "phone-1", "token")).resolves.toEqual({
      id: "phone-1",
      displayPhoneNumber: "+254700000001",
      verifiedName: "Merchant One",
    });
    await expect(getWhatsAppPhoneNumber("waba-1", "phone-2", "token")).rejects.toThrow("whatsapp_phone_not_in_waba");
  });
});
