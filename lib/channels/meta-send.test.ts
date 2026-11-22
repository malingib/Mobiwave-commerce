import { afterEach, describe, expect, it, vi } from "@/lib/test-runtime";
import { sendMetaTextMessage } from "@/lib/channels/meta-send";

afterEach(() => vi.unstubAllGlobals());

describe("official Meta outbound text sender", () => {
  it("sends WhatsApp text through the connected phone-number ID", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      messaging_product: "whatsapp",
      messages: [{ id: "wamid.outbound.1" }],
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(sendMetaTextMessage({
      channel: "whatsapp",
      accountId: "phone-number-1",
      recipientId: "254700000001",
      accessToken: "server-token",
      text: "Hello from MobiWave",
    })).resolves.toEqual({ messageId: "wamid.outbound.1" });
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(String(url)).toContain("graph.facebook.com/v27.0/phone-number-1/messages");
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer server-token");
    expect(JSON.parse(String(init.body))).toMatchObject({
      messaging_product: "whatsapp",
      to: "254700000001",
      type: "text",
      text: { body: "Hello from MobiWave" },
    });
  });

  it("sends Instagram text using the professional account ID", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      recipient_id: "ig-customer-1",
      message_id: "ig.outbound.1",
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(sendMetaTextMessage({
      channel: "instagram",
      accountId: "ig-business-1",
      recipientId: "ig-customer-1",
      accessToken: "server-token",
      text: "Thanks for your enquiry",
    })).resolves.toEqual({ messageId: "ig.outbound.1" });
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(String(url)).toContain("graph.instagram.com/v27.0/ig-business-1/messages");
    expect(JSON.parse(String(init.body))).toEqual({
      recipient: { id: "ig-customer-1" },
      message: { text: "Thanks for your enquiry" },
    });
  });

  it("does not retry or disguise an ambiguous network failure", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("socket timed out"));
    vi.stubGlobal("fetch", fetchMock);
    await expect(sendMetaTextMessage({
      channel: "whatsapp",
      accountId: "phone-number-1",
      recipientId: "254700000001",
      accessToken: "server-token",
      text: "Do not duplicate",
    })).rejects.toThrow("delivery_unknown");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not expose provider response bodies when Meta rejects a send", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: { message: "Sensitive provider detail", code: 131047 },
    }), { status: 400 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(sendMetaTextMessage({
      channel: "whatsapp",
      accountId: "phone-number-1",
      recipientId: "254700000001",
      accessToken: "server-token",
      text: "Hello",
    })).rejects.toThrow("meta_api_131047");
  });
});
