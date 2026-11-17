import { describe, expect, it } from "vitest";
import { normalizeMetaWebhook } from "@/lib/channels/meta-adapter";

describe("Meta webhook normalization", () => {
  it("normalizes WhatsApp inbound messages and status events independently", () => {
    const events = normalizeMetaWebhook({
      object: "whatsapp_business_account",
      entry: [{
        id: "waba-1",
        changes: [{
          field: "messages",
          value: {
            metadata: { phone_number_id: "phone-1" },
            messages: [{ id: "wamid-1", from: "254700000001", timestamp: "1794912000", type: "text", text: { body: "Hello" } }],
            statuses: [{ id: "wamid-2", status: "delivered", timestamp: "1794912001" }],
          },
        }],
      }],
    });
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ channel: "whatsapp", providerAccountId: "waba-1", providerAddressId: "phone-1", providerEventId: "wa:message:wamid-1:1794912000:message" });
    expect(events[1]).toMatchObject({ eventType: "whatsapp.messages.status", providerEventId: "wa:status:wamid-2:1794912001:delivered" });
  });

  it("normalizes Instagram messages and delivery events", () => {
    const events = normalizeMetaWebhook({
      object: "instagram",
      entry: [{
        id: "ig-business-1",
        messaging: [
          { sender: { id: "customer-1" }, timestamp: 1794912000000, message: { mid: "ig-mid-1", text: "Hi" } },
          { delivery: { mids: ["ig-mid-1"] }, timestamp: 1794912001000 },
        ],
      }],
    });
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ channel: "instagram", providerAccountId: "ig-business-1", providerEventId: "ig:message:ig-mid-1" });
    expect(events[0].occurredAt).toBe(new Date(1794912000000).toISOString());
    expect(events[1].eventType).toBe("instagram.delivery");
  });

  it("ignores unsupported payload roots and malformed entries", () => {
    expect(normalizeMetaWebhook({ object: "page", entry: [] })).toEqual([]);
    expect(normalizeMetaWebhook({ object: "instagram", entry: [{ changes: [] }] })).toEqual([]);
  });

  it("deduplicates deterministic status and change identifiers", () => {
    const payload = { object: "instagram", entry: [{ id: "ig-1", changes: [{ field: "comments", value: { id: "c-1" } }] }] };
    expect(normalizeMetaWebhook(payload)[0].providerEventId).toBe(normalizeMetaWebhook(payload)[0].providerEventId);
  });
});
