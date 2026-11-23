import { db } from "@/lib/db";
import { decryptChannelCredential } from "@/lib/channels/credentials";
import { sendMetaTextMessage } from "@/lib/channels/meta-send";
import { sendMetaMediaMessage, uploadMetaMedia } from "@/lib/channels/meta-media";
import { readPrivateObject } from "@/lib/media/storage";
import { sendMetaTemplateMessage } from "@/lib/channels/meta-template-send";

type ClaimedMessage = {
  id: string;
  store_id: string;
  connection_id: string;
  conversation_id: string;
  message_id: string;
  channel: "whatsapp" | "instagram";
  connection_status: string;
  provider_account_id: string | null;
  provider_address_id: string | null;
  recipient_id: string;
  content: string | null;
  message_type: string;
  raw_metadata: Record<string, unknown>;
  token_ciphertext: string | null;
  credential_scopes: string[];
  credential_expires_at: string | null;
  last_inbound_at: string | null;
  attachment_storage_key: string | null;
  attachment_mime_type: string | null;
  attachment_file_name: string | null;
  attachment_scan_status: string | null;
};

async function markFailure(item: ClaimedMessage, code: string) {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.channel_worker','true',true)");
    await client.query(
      `UPDATE message_outbox
          SET status='failed',last_error_code=$1,locked_at=NULL,locked_by=NULL,updated_at=now()
        WHERE id=$2 AND status='processing'`,
      [code.slice(0, 80), item.id],
    );
    await client.query(
      `UPDATE conversation_messages
          SET provider_status='failed',provider_error_code=$1
        WHERE store_id=$2 AND id=$3 AND provider_status='queued'`,
      [code.slice(0, 80), item.store_id, item.message_id],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function markSent(item: ClaimedMessage, providerMessageId: string) {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.channel_worker','true',true)");
    await client.query(
      `UPDATE conversation_messages
          SET provider_message_id=$1,provider_status='sent',sent_at=now(),
              provider_timestamp=now(),provider_error_code=NULL
        WHERE store_id=$2 AND id=$3`,
      [providerMessageId, item.store_id, item.message_id],
    );
    await client.query(
      `UPDATE message_outbox
          SET status='sent',last_error_code=NULL,locked_at=NULL,locked_by=NULL,updated_at=now()
        WHERE id=$1 AND status='processing'`,
      [item.id],
    );
    await client.query(
      `UPDATE conversations SET last_message_at=GREATEST(COALESCE(last_message_at,'-infinity'::timestamptz),now()),updated_at=now()
        WHERE store_id=$1 AND id=$2`,
      [item.store_id, item.conversation_id],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function processOutboundMessageBatch(batchSize = 20) {
  const limit = Math.max(1, Math.min(Math.floor(batchSize) || 20, 100));
  const workerId = (process.env.CHANNEL_WORKER_ID || "mobiwave-outbound-worker").slice(0, 100);
  const client = await db.connect();
  const claimed: ClaimedMessage[] = [];
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.channel_worker','true',true)");

    // A worker crash after a provider accepted a message is ambiguous. Mark stale
    // leases as delivery_unknown instead of retrying and risking duplicate sends.
    const stale = await client.query(
      `UPDATE message_outbox
          SET status='failed',last_error_code='delivery_unknown',
              locked_at=NULL,locked_by=NULL,updated_at=now()
        WHERE status='processing' AND locked_at < now()-interval '10 minutes'
        RETURNING store_id,message_id`,
    );
    for (const row of stale.rows) {
      await client.query(
        `UPDATE conversation_messages
            SET provider_status='failed',provider_error_code='delivery_unknown'
          WHERE store_id=$1 AND id=$2 AND provider_status='queued'`,
        [row.store_id, row.message_id],
      );
    }

    const due = await client.query(
      `SELECT o.id,o.store_id,o.connection_id,o.conversation_id,o.message_id,
              cc.channel,cc.status AS connection_status,cc.provider_account_id,cc.provider_address_id,
              ci.external_user_id AS recipient_id,m.content,m.message_type,m.raw_metadata,cred.token_ciphertext,cred.scopes AS credential_scopes,cred.expires_at AS credential_expires_at,
              (SELECT COALESCE(inbound.provider_timestamp,inbound.created_at)
                 FROM conversation_messages inbound
                WHERE inbound.store_id=o.store_id AND inbound.conversation_id=o.conversation_id
                  AND inbound.direction='inbound'
                ORDER BY COALESCE(inbound.provider_timestamp,inbound.created_at) DESC LIMIT 1) AS last_inbound_at,
              attachment.storage_key AS attachment_storage_key,
              attachment.detected_mime_type AS attachment_mime_type,
              attachment.file_name AS attachment_file_name,
              attachment.scan_status AS attachment_scan_status
         FROM message_outbox o
         JOIN conversation_messages m ON m.store_id=o.store_id AND m.id=o.message_id
         JOIN conversations c ON c.store_id=o.store_id AND c.id=o.conversation_id
         JOIN channel_connections cc ON cc.store_id=o.store_id AND cc.id=o.connection_id
         JOIN channel_identities ci ON ci.store_id=c.store_id AND ci.id=c.identity_id
         LEFT JOIN channel_credentials cred ON cred.store_id=cc.store_id AND cred.id=cc.credential_ref
         LEFT JOIN LATERAL (
           SELECT a.storage_key,a.detected_mime_type,a.file_name,a.scan_status
             FROM conversation_attachments a
            WHERE a.store_id=m.store_id AND a.message_id=m.id
            ORDER BY a.created_at
            LIMIT 1
         ) attachment ON true
        WHERE o.status='queued' AND o.next_attempt_at<=now()
        ORDER BY o.created_at
        LIMIT $1
        FOR UPDATE OF o SKIP LOCKED`,
      [limit],
    );
    for (const row of due.rows as ClaimedMessage[]) {
      await client.query(
        `UPDATE message_outbox SET status='processing',attempt_count=attempt_count+1,
            locked_at=now(),locked_by=$1,updated_at=now() WHERE id=$2`,
        [workerId, row.id],
      );
      claimed.push(row);
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }

  let sent = 0;
  let failed = 0;
  for (const item of claimed) {
    try {
      if (item.connection_status !== "connected") throw new Error("channel_not_connected");
      if (!item.token_ciphertext) throw new Error("channel_credential_missing");
      if (item.credential_expires_at && new Date(item.credential_expires_at).getTime() <= Date.now()) throw new Error("channel_credential_expired");
      const lastInbound = item.last_inbound_at ? new Date(item.last_inbound_at).getTime() : 0;
      if (item.message_type !== "template" && (!lastInbound || !Number.isFinite(lastInbound) || Date.now() - lastInbound > 24 * 60 * 60 * 1000)) {
        throw new Error("messaging_window_expired");
      }
      if (item.message_type === "template" && item.channel !== "whatsapp") throw new Error("template_channel_unsupported");
      if (item.message_type === "template" && !item.credential_scopes?.includes("whatsapp_business_management")) throw new Error("template_management_permission_missing");
      const accountId = item.channel === "whatsapp" ? item.provider_address_id : item.provider_account_id;
      if (!accountId) throw new Error("provider_account_missing");
      const token = decryptChannelCredential(item.token_ciphertext);
      let result: { messageId: string };
      if (item.message_type === "template") {
        result = await sendMetaTemplateMessage({
          phoneNumberId: accountId,
          wabaId: item.provider_account_id || "",
          recipientId: item.recipient_id,
          accessToken: token,
          template: item.raw_metadata,
        });
      } else if (["image", "video", "audio", "document"].includes(item.message_type)) {
        if (item.channel !== "whatsapp") throw new Error("instagram_media_send_unsupported");
        if (!item.attachment_storage_key || item.attachment_scan_status !== "available" || !item.attachment_mime_type) {
          throw new Error("outbound_media_not_available");
        }
        const bytes = await readPrivateObject(item.attachment_storage_key);
        const mime = item.attachment_mime_type.toLowerCase();
        const mediaType = mime.startsWith("image/") ? "image"
          : mime.startsWith("video/") ? "video"
          : mime.startsWith("audio/") ? "audio" : "document";
        if (mediaType !== item.message_type) throw new Error("outbound_media_type_mismatch");
        const mediaId = await uploadMetaMedia({
          phoneNumberId: accountId,
          accessToken: token,
          bytes,
          mimeType: mime,
          fileName: item.attachment_file_name || "attachment",
        });
        result = await sendMetaMediaMessage({
          phoneNumberId: accountId,
          recipientId: item.recipient_id,
          accessToken: token,
          mediaId,
          mediaType,
          caption: item.content,
          fileName: item.attachment_file_name,
        });
      } else {
        result = await sendMetaTextMessage({
          channel: item.channel,
          accountId,
          recipientId: item.recipient_id,
          accessToken: token,
          text: item.content || "",
        });
      }
      await markSent(item, result.messageId);
      sent++;
    } catch (error) {
      const raw = error instanceof Error ? error.message : "outbound_send_failed";
      const code = /^[a-z0-9_]{1,80}$/i.test(raw) ? raw : "outbound_send_failed";
      await markFailure(item, code);
      failed++;
    }
  }
  return { claimed: claimed.length, sent, failed };
}
