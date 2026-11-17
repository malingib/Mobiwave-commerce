import type { PoolClient } from "pg";
import { db } from "@/lib/db";

type JsonObject = Record<string, unknown>;
type ClaimedWebhook = {
  id: string;
  store_id: string;
  connection_id: string;
  event_type: string;
  payload: JsonObject;
  attempt_count: number;
};
type ProcessResult = "processed" | "ignored";

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function nestedObject(value: unknown, key: string): JsonObject | null {
  if (!isObject(value)) return null;
  const nested = value[key];
  return isObject(nested) ? nested : null;
}

export function normalizeProviderTimestamp(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const numeric = typeof value === "number" || /^\d+(?:\.\d+)?$/.test(value) ? Number(value) : null;
  const date = new Date(numeric === null ? value : numeric > 100_000_000_000 ? numeric : numeric * 1000);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function mapProviderStatus(value: unknown): "sent" | "delivered" | "read" | "failed" | null {
  if (typeof value !== "string") return null;
  const status = value.toLowerCase();
  if (status === "sent" || status === "delivered" || status === "read" || status === "failed") return status;
  return null;
}

function normalizeMessageType(value: unknown): "text" | "image" | "video" | "audio" | "document" | "location" | "interactive" | "template" | "unsupported" {
  if (typeof value !== "string") return "unsupported";
  if (value === "sticker") return "image";
  if (["text", "image", "video", "audio", "document", "location", "interactive", "template"].includes(value)) {
    return value as "text" | "image" | "video" | "audio" | "document" | "location" | "interactive" | "template";
  }
  return "unsupported";
}

function messageText(item: JsonObject, channel: "whatsapp" | "instagram"): string | null {
  const text = nestedObject(item, "text");
  if (typeof text?.body === "string") return text.body.slice(0, 10000);
  if (typeof text?.text === "string") return text.text.slice(0, 10000);
  for (const key of ["image", "video", "document"]) {
    const media = nestedObject(item, key);
    if (typeof media?.caption === "string") return media.caption.slice(0, 10000);
  }
  const interactive = nestedObject(item, "interactive");
  const button = nestedObject(interactive, "button_reply");
  if (typeof button?.title === "string") return button.title.slice(0, 10000);
  const list = nestedObject(interactive, "list_reply");
  if (typeof list?.title === "string") return list.title.slice(0, 10000);
  if (channel === "instagram" && Array.isArray(item.attachments)) return null;
  return null;
}

function normalizedPhone(externalId: string) {
  return /^\d{8,15}$/.test(externalId) ? \`+\${externalId}\` : null;
}

function whatsappDisplayName(value: JsonObject, externalId: string) {
  if (!Array.isArray(value.contacts)) return null;
  for (const contactValue of value.contacts) {
    if (!isObject(contactValue) || contactValue.wa_id !== externalId) continue;
    const profile = nestedObject(contactValue, "profile");
    if (typeof profile?.name === "string") return profile.name.slice(0, 120);
  }
  return null;
}

async function getOrCreateIdentity(
  client: PoolClient,
  storeId: string,
  channel: "whatsapp" | "instagram",
  externalUserId: string,
  displayName: string | null,
) {
  const phone = channel === "whatsapp" ? normalizedPhone(externalUserId) : null;
  const result = await client.query(
    \`INSERT INTO channel_identities
       (store_id, channel, external_user_id, display_name, phone_e164, profile)
     VALUES ($1,$2,$3,$4,$5,$6::jsonb)
     ON CONFLICT (store_id, channel, external_user_id)
     DO UPDATE SET
       display_name = COALESCE(EXCLUDED.display_name, channel_identities.display_name),
       phone_e164 = COALESCE(EXCLUDED.phone_e164, channel_identities.phone_e164),
       updated_at = now()
     RETURNING id\`,
    [storeId, channel, externalUserId, displayName, phone, JSON.stringify(displayName ? { name: displayName } : {})],
  );
  return String(result.rows[0].id);
}

async function getOrCreateConversation(
  client: PoolClient,
  storeId: string,
  connectionId: string,
  identityId: string,
  channel: "whatsapp" | "instagram",
  externalThreadId: string,
) {
  const result = await client.query(
    \`INSERT INTO conversations
       (store_id, connection_id, identity_id, channel, external_thread_id)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (connection_id, external_thread_id) WHERE external_thread_id IS NOT NULL
     DO UPDATE SET
       status = CASE WHEN conversations.status IN ('resolved','archived') THEN 'open' ELSE conversations.status END,
       resolved_at = CASE WHEN conversations.status IN ('resolved','archived') THEN NULL ELSE conversations.resolved_at END,
       updated_at = now()
     RETURNING id\`,
    [storeId, connectionId, identityId, channel, externalThreadId],
  );
  return String(result.rows[0].id);
}

async function persistMessage(
  client: PoolClient,
  event: ClaimedWebhook,
  channel: "whatsapp" | "instagram",
  item: JsonObject,
  value: JsonObject,
  customerId: string,
  direction: "inbound" | "outbound",
) {
  if (!customerId) throw new Error("invalid_customer_identity");
  const displayName = channel === "whatsapp" ? whatsappDisplayName(value, customerId) : null;
  const identityId = await getOrCreateIdentity(client, event.store_id, channel, customerId, displayName);
  const conversationId = await getOrCreateConversation(
    client, event.store_id, event.connection_id, identityId, channel, customerId,
  );
  const message = channel === "instagram" ? nestedObject(item, "message") || item : item;
  const typeValue = message.type || (Array.isArray(message.attachments) && isObject(message.attachments[0])
    ? message.attachments[0].type
    : "text");
  const messageType = normalizeMessageType(typeValue);
  const providerMessageId = typeof message.id === "string"
    ? message.id
    : typeof message.mid === "string" ? message.mid : null;
  const occurredAt = normalizeProviderTimestamp(item.timestamp);
  const content = messageText(message, channel);
  const inserted = await client.query(
    \`INSERT INTO conversation_messages
       (store_id, conversation_id, connection_id, provider_message_id, direction,
        message_type, content, provider_status, provider_timestamp, raw_metadata)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)
     ON CONFLICT DO NOTHING
     RETURNING id\`,
    [
      event.store_id, conversationId, event.connection_id, providerMessageId, direction,
      messageType, content, direction === "outbound" ? "sent" : "received",
      occurredAt, JSON.stringify(item),
    ],
  );

  // A provider retry must not create a second message or increment unread count.
  if (inserted.rowCount) {
    await client.query(
      \`UPDATE conversations
          SET last_message_at = GREATEST(COALESCE(last_message_at, '-infinity'::timestamptz), COALESCE($1::timestamptz, now())),
              unread_count = unread_count + $2,
              updated_at = now()
        WHERE store_id = $3 AND id = $4\`,
      [occurredAt, direction === "inbound" ? 1 : 0, event.store_id, conversationId],
    );
  }
}

async function updateProviderMessageStatus(
  client: PoolClient,
  connectionId: string,
  providerMessageId: string,
  status: "sent" | "delivered" | "read" | "failed",
  occurredAt: string | null,
  errorCode: string | null,
) {
  const result = await client.query(
    \`UPDATE conversation_messages
        SET provider_status = $1,
            sent_at = CASE WHEN $1 = 'sent' THEN COALESCE(sent_at, $2::timestamptz) ELSE sent_at END,
            delivered_at = CASE WHEN $1 = 'delivered' THEN COALESCE(delivered_at, $2::timestamptz) ELSE delivered_at END,
            read_at = CASE WHEN $1 = 'read' THEN COALESCE(read_at, $2::timestamptz) ELSE read_at END,
            provider_error_code = COALESCE($3, provider_error_code)
      WHERE connection_id = $4 AND provider_message_id = $5\`,
    [status, occurredAt, errorCode, connectionId, providerMessageId],
  );
  if (!result.rowCount) throw new Error("provider_message_not_found");
}

async function processStatusEvent(client: PoolClient, event: ClaimedWebhook, connectionId: string) {
  const item = nestedObject(event.payload, "item");
  if (!item) throw new Error("invalid_status_payload");
  const status = mapProviderStatus(item.status);
  const messageId = typeof item.id === "string" ? item.id : "";
  if (!status || !messageId) throw new Error("unsupported_status_payload");
  const errors = Array.isArray(item.errors) && isObject(item.errors[0]) ? item.errors[0] : null;
  const errorCode = errors && errors.code !== undefined ? String(errors.code).slice(0, 80) : null;
  await updateProviderMessageStatus(
    client, connectionId, messageId, status,
    normalizeProviderTimestamp(item.timestamp), errorCode,
  );
}

async function processInstagramStatusEvent(client: PoolClient, event: ClaimedWebhook, connectionId: string) {
  const delivery = nestedObject(event.payload, "delivery");
  const read = nestedObject(event.payload, "read");
  const status = delivery ? "delivered" : read ? "read" : null;
  const ids = delivery && Array.isArray(delivery.mids)
    ? delivery.mids
    : read && typeof read.mid === "string" ? [read.mid] : [];
  if (!status || !ids.length) throw new Error("invalid_instagram_status_payload");
  const occurredAt = normalizeProviderTimestamp(event.payload.timestamp);
  for (const id of ids) {
    if (typeof id !== "string" || !id) continue;
    await updateProviderMessageStatus(client, connectionId, id, status, occurredAt, null);
  }
}

async function processEventPayload(client: PoolClient, event: ClaimedWebhook, channel: string): Promise<ProcessResult> {
  if (channel !== "whatsapp" && channel !== "instagram") return "ignored";
  if (event.event_type.endsWith(".status")) {
    await processStatusEvent(client, event, event.connection_id);
    return "processed";
  }
  if (event.event_type === "instagram.delivery" || event.event_type === "instagram.read") {
    await processInstagramStatusEvent(client, event, event.connection_id);
    return "processed";
  }

  if (event.event_type.endsWith(".message") || event.event_type === "instagram.message") {
    if (channel === "whatsapp") {
      const item = nestedObject(event.payload, "item");
      const value = nestedObject(event.payload, "value") || {};
      const sender = typeof item?.from === "string" ? item.from : "";
      if (!item || !sender) throw new Error("invalid_whatsapp_message_payload");
      await persistMessage(client, event, "whatsapp", item, value, sender, "inbound");
      return "processed";
    }
    const sender = nestedObject(event.payload, "sender");
    const recipient = nestedObject(event.payload, "recipient");
    const message = nestedObject(event.payload, "message");
    const isEcho = message?.is_echo === true;
    const customerId = isEcho
      ? (typeof recipient?.id === "string" ? recipient.id : "")
      : (typeof sender?.id === "string" ? sender.id : "");
    if (!message || !customerId) throw new Error("invalid_instagram_message_payload");
    await persistMessage(client, event, "instagram", event.payload, {}, customerId, isEcho ? "outbound" : "inbound");
    return "processed";
  }
  return "ignored";
}

async function processClaimedEvent(event: ClaimedWebhook) {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.channel_worker','true',true)");
    const connection = await client.query(
      "SELECT channel FROM channel_connections WHERE id=$1 AND store_id=$2 LIMIT 1",
      [event.connection_id, event.store_id],
    );
    if (!connection.rowCount) {
      await client.query(
        "UPDATE channel_webhook_events SET processing_status='ignored', processed_at=now(), locked_at=NULL, locked_by=NULL, last_error_code='connection_not_found' WHERE id=$1",
        [event.id],
      );
      await client.query("COMMIT");
      return "ignored" as const;
    }
    const result = await processEventPayload(client, event, String(connection.rows[0].channel));
    await client.query(
      "UPDATE channel_webhook_events SET processing_status=$1, processed_at=now(), locked_at=NULL, locked_by=NULL, last_error_code=NULL WHERE id=$2",
      [result, event.id],
    );
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function recordFailure(event: ClaimedWebhook, error: unknown) {
  const permanentCodes = new Set([
    "invalid_customer_identity", "invalid_status_payload", "unsupported_status_payload",
    "invalid_instagram_status_payload", "invalid_whatsapp_message_payload",
    "invalid_instagram_message_payload",
  ]);
  const rawCode = error instanceof Error ? error.message : "webhook_processing_failed";
  const code = /^[a-z0-9_]{1,80}$/i.test(rawCode) ? rawCode : "webhook_processing_failed";
  const permanent = permanentCodes.has(code);
  const exhausted = event.attempt_count >= 5;
  const delayMinutes = exhausted ? 1440 : Math.min(60, 2 ** Math.min(event.attempt_count, 6));
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.channel_worker','true',true)");
    await client.query(
      \`UPDATE channel_webhook_events
          SET processing_status=$1,
              next_attempt_at=now()+($2 * interval '1 minute'),
              locked_at=NULL, locked_by=NULL, last_error_code=$3
        WHERE id=$4 AND processing_status='processing'\`,
      [permanent ? "ignored" : "failed", delayMinutes, code, event.id],
    );
    await client.query("COMMIT");
  } catch (updateError) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw updateError;
  } finally {
    client.release();
  }
  return permanent ? "ignored" : exhausted ? "failed" : "retried";
}

export async function processMetaWebhookBatch(batchSize = 25) {
  const limit = Math.max(1, Math.min(Math.floor(batchSize) || 25, 100));
  const workerId = (process.env.CHANNEL_WORKER_ID || "mobiwave-channel-worker").slice(0, 100);
  const claimClient = await db.connect();
  const claimed: ClaimedWebhook[] = [];
  try {
    await claimClient.query("BEGIN");
    await claimClient.query("SELECT set_config('app.channel_worker','true',true)");
    const due = await claimClient.query(
      \`SELECT id, store_id, connection_id, event_type, payload, attempt_count
         FROM channel_webhook_events
        WHERE (
          (processing_status IN ('received','failed') AND next_attempt_at <= now())
          OR (processing_status='processing' AND locked_at < now() - interval '10 minutes')
        )
        ORDER BY received_at ASC
        FOR UPDATE SKIP LOCKED
        LIMIT $1\`,
      [limit],
    );
    for (const row of due.rows as ClaimedWebhook[]) {
      const updated = await claimClient.query(
        \`UPDATE channel_webhook_events
            SET processing_status='processing', attempt_count=attempt_count+1,
                locked_at=now(), locked_by=$1
          WHERE id=$2
          RETURNING attempt_count\`,
        [workerId, row.id],
      );
      claimed.push({ ...row, attempt_count: Number(updated.rows[0]?.attempt_count || row.attempt_count + 1) });
    }
    await claimClient.query("COMMIT");
  } catch (error) {
    await claimClient.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    claimClient.release();
  }

  let processed = 0;
  let ignored = 0;
  let retried = 0;
  let failed = 0;
  for (const event of claimed) {
    try {
      const result = await processClaimedEvent(event);
      if (result === "processed") processed++;
      else ignored++;
    } catch (error) {
      const result = await recordFailure(event, error);
      if (result === "ignored") ignored++;
      else if (result === "failed") failed++;
      else retried++;
    }
  }
  return { claimed: claimed.length, processed, ignored, retried, failed };
}
