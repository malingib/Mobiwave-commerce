import { createHash } from "node:crypto";
import type { NormalizedProviderEvent } from "@/lib/channels/types";

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stableEventId(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function timestamp(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const date = new Date(typeof value === "number" ? value * 1000 : value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/**
 * Convert WhatsApp Cloud API and Instagram Messaging webhook entries into
 * channel-neutral, independently deduplicated events. Unknown event shapes
 * are retained as provider events rather than silently discarded.
 */
export function normalizeMetaWebhook(payload: unknown): NormalizedProviderEvent[] {
  if (!isObject(payload) || !Array.isArray(payload.entry)) return [];
  const channel = payload.object === "whatsapp_business_account"
    ? "whatsapp"
    : payload.object === "instagram"
      ? "instagram"
      : null;
  if (!channel) return [];

  const events: NormalizedProviderEvent[] = [];
  for (const entryValue of payload.entry) {
    if (!isObject(entryValue) || typeof entryValue.id !== "string" || !entryValue.id) continue;
    const providerAccountId = entryValue.id;

    if (channel === "whatsapp") {
      const changes = Array.isArray(entryValue.changes) ? entryValue.changes : [];
      for (const changeValue of changes) {
        if (!isObject(changeValue)) continue;
        const field = typeof changeValue.field === "string" ? changeValue.field : "unknown";
        const value = isObject(changeValue.value) ? changeValue.value : {};
        const groups: Array<{ type: string; values: unknown[] }> = [
          { type: "message", values: Array.isArray(value.messages) ? value.messages : [] },
          { type: "status", values: Array.isArray(value.statuses) ? value.statuses : [] },
        ];
        const recognized = groups.some(group => group.values.length > 0);
        if (!recognized) {
          const normalized = { field, value };
          events.push({
            channel, providerAccountId, providerEventId: stableEventId(normalized),
            eventType: `whatsapp.${field}`, occurredAt: null, payload: normalized,
          });
          continue;
        }
        for (const group of groups) {
          for (const item of group.values) {
            if (!isObject(item)) continue;
            const id = typeof item.id === "string" ? item.id : stableEventId({ field, item });
            const state = typeof item.status === "string" ? item.status : group.type;
            events.push({
              channel, providerAccountId,
              providerEventId: `wa:${group.type}:${id}:${String(item.timestamp || "")}:${state}`,
              eventType: `whatsapp.${field}.${group.type}`,
              occurredAt: timestamp(item.timestamp),
              payload: { field, value, item },
            });
          }
        }
      }
    } else {
      const messaging = Array.isArray(entryValue.messaging) ? entryValue.messaging : [];
      for (const itemValue of messaging) {
        if (!isObject(itemValue)) continue;
        const message = isObject(itemValue.message) ? itemValue.message : null;
        const delivery = isObject(itemValue.delivery) ? itemValue.delivery : null;
        const read = isObject(itemValue.read) ? itemValue.read : null;
        const type = message ? "message" : delivery ? "delivery" : read ? "read" : "messaging_event";
        const id = message && typeof message.mid === "string" ? message.mid : stableEventId(itemValue);
        events.push({
          channel, providerAccountId, providerEventId: `ig:${type}:${id}`,
          eventType: `instagram.${type}`,
          occurredAt: timestamp(itemValue.timestamp),
          payload: itemValue,
        });
      }
      const changes = Array.isArray(entryValue.changes) ? entryValue.changes : [];
      for (const changeValue of changes) {
        if (!isObject(changeValue)) continue;
        const normalized = { field: changeValue.field, value: changeValue.value };
        events.push({
          channel, providerAccountId, providerEventId: `ig:change:${stableEventId(normalized)}`,
          eventType: `instagram.change.${String(changeValue.field || "unknown")}`,
          occurredAt: null, payload: normalized,
        });
      }
    }
  }
  return events;
}
