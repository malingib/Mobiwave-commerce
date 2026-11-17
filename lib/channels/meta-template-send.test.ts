import { afterEach, describe, expect, it, vi } from "vitest";
import { sendMetaTemplateMessage } from "@/lib/channels/meta-template-send";

afterEach(() => vi.unstubAllGlobals());

const input = {
  phoneNumberId: "phone-number-1",
  wabaId: "waba-1",
  recipientId: "254700000001",
  accessToken: "server-token",
  template: { name: "order_update", language: { code: "en" }, components: [{ type: "body", parameters: [{ type: "text", text: "A-100" }] }] },
};

describe("approved WhatsApp template sender", () => {
  it("checks the exact template name, language and APPROVED status before sending", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ name: "order_update", language: "en", status: "APPROVED" }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ messages: [{ id: "wamid.template.1" }] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(sendMetaTemplateMessage(input)).resolves.toEqual({ messageId: "wamid.template.1" });
    expect(String(fetchMock.mock.calls[0][0])).toContain("/waba-1/message_templates");
    expect(String(fetchMock.mock.calls[1][0])).toContain("/phone-number-1/messages");
    expect(JSON.parse(String(fetchMock.mock.calls[1][1].body))).toMatchObject({
      messaging_product: "whatsapp", to: "254700000001", type: "template",
      template: { name: "order_update", language: { code: "en" } },
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("never sends a template that is pending, rejected or in another language", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      data: [{ name: "order_update", language: "en", status: "PENDING" }],
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(sendMetaTemplateMessage(input)).rejects.toThrow("template_not_approved");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("fails closed when the approval lookup cannot be completed", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("network unavailable"));
    vi.stubGlobal("fetch", fetchMock);
    await expect(sendMetaTemplateMessage(input)).rejects.toThrow("template_approval_check_unknown");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not retry an ambiguous send response", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ name: "order_update", language: "en", status: "APPROVED" }] }), { status: 200 }))
      .mockRejectedValueOnce(new Error("socket timeout"));
    vi.stubGlobal("fetch", fetchMock);
    await expect(sendMetaTemplateMessage(input)).rejects.toThrow("delivery_unknown");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
