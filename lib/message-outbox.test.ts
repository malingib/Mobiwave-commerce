import { afterEach, describe, expect, it, vi } from "vitest";
import { renderCommerceSms, sendMobiWaveSms } from "@/lib/message-outbox";

describe("transactional commerce SMS templates", () => {
  it("renders order received details without trusting HTML", () => {
    const message = renderCommerceSms("order_received", {
      storeName: "Kilifi Store",
      customerName: "Amina",
      orderNumber: "MW-1001",
      totalMinor: 125050,
      currency: "KES",
    });
    expect(message).toContain("Amina");
    expect(message).toContain("MW-1001");
    expect(message).toContain("KES 1,250.5");
  });

  it("warns customers not to pay again while a payment is uncertain", () => {
    const message = renderCommerceSms("order_payment_failed", {
      storeName: "Test Store",
      customerName: "Amina",
      orderNumber: "MW-1002",
    });
    expect(message).toContain("If you were charged");
    expect(message).toContain("before paying again");
  });
});

describe("MobiWave v3 SMS adapter", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("sends the documented request to the v3 SMS endpoint and returns the provider UID", async () => {
    vi.stubEnv("MOBIWAVE_SMS_API_URL", "https://sms.mobiwave.co.ke/api/v3");
    vi.stubEnv("MOBIWAVE_SMS_API_KEY", "test-api-token");
    vi.stubEnv("MOBIWAVE_SMS_SENDER_ID", "MOBIWAVE");

    const fetchMock = vi.fn<typeof fetch>(async () =>
      new Response(JSON.stringify({ status: "success", data: { uid: "sms_123" } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(sendMobiWaveSms("254700000000", "Order received", "order-123")).resolves.toBe("sms_123");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("https://sms.mobiwave.co.ke/api/v3/sms/send");
    expect(init?.method).toBe("POST");
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer test-api-token");
    expect(JSON.parse(String(init?.body))).toEqual({
      recipient: "254700000000",
      sender_id: "MOBIWAVE",
      type: "plain",
      message: "Order received",
    });
  });

  it("rejects provider-level failures even when the HTTP request succeeds", async () => {
    vi.stubEnv("MOBIWAVE_SMS_API_KEY", "test-api-token");
    vi.stubEnv("MOBIWAVE_SMS_SENDER_ID", "MOBIWAVE");
    const fetchMock = vi.fn<typeof fetch>(async () =>
      new Response(JSON.stringify({ status: "error", message: "Invalid sender ID" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(sendMobiWaveSms("254700000000", "Order received", "order-123")).rejects.toThrow(
      "sms_provider_rejected",
    );
  });

  it("rejects sender IDs longer than the provider's 11-character limit", async () => {
    vi.stubEnv("MOBIWAVE_SMS_API_KEY", "test-api-token");
    vi.stubEnv("MOBIWAVE_SMS_SENDER_ID", "MOBIWAVE-STORE");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(sendMobiWaveSms("254700000000", "Order received", "order-123")).rejects.toThrow(
      "sms_sender_id_too_long",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
