import type { PoolClient } from "pg";
import { db } from "@/lib/db";
import { normalizeKenyanPhone } from "@/lib/mpesa-utils";

type SmsEventInput = {
  storeId: string;
  orderId?: string | null;
  recipient: string;
  templateKey: "order_received" | "order_status" | "order_payment_received" | "order_payment_failed" | "subscription_payment_received";
  dedupeKey: string;
  payload: Record<string, unknown>;
};
type QueuedSms = {
  id: string;
  store_id: string;
  recipient: string;
  template_key: SmsEventInput["templateKey"];
  dedupe_key: string;
  payload: Record<string, unknown>;
  attempt_count: number;
};

export async function enqueueSms(client: PoolClient, event: SmsEventInput) {
  const recipient = normalizeKenyanPhone(event.recipient);
  if (!recipient) return;
  await client.query(
    `INSERT INTO message_events (store_id, order_id, channel, recipient, template_key, status, dedupe_key, payload)
     VALUES ($1,$2,'sms',$3,$4,'queued',$5,$6::jsonb)
     ON CONFLICT (store_id, dedupe_key) DO NOTHING`,
    [event.storeId, event.orderId || null, recipient, event.templateKey, event.dedupeKey, JSON.stringify(event.payload)],
  );
}

export function renderCommerceSms(templateKey: SmsEventInput["templateKey"], payload: Record<string, unknown>) {
  const store = String(payload.storeName || "the store").slice(0, 80);
  const customer = String(payload.customerName || "Customer").slice(0, 60);
  const order = String(payload.orderNumber || "").slice(0, 32);
  switch (templateKey) {
    case "order_received": {
      const amount = (Number(payload.totalMinor) / 100).toLocaleString("en-KE", { maximumFractionDigits: 2 });
      return `Hi ${customer}, ${store} received order #${order}. Total: ${String(payload.currency || "KES")} ${amount}. Thank you.`;
    }
    case "order_status":
      return `Hi ${customer}, order #${order} from ${store} is now ${String(payload.status || "updated")}.`;
    case "order_payment_received":
      return `Hi ${customer}, payment for order #${order} at ${store} is confirmed. M-Pesa receipt: ${String(payload.receipt || "").slice(0, 20)}.`;
    case "order_payment_failed":
      return `Hi ${customer}, payment for order #${order} at ${store} was not confirmed. If you were charged, contact the store before paying again.`;
    case "subscription_payment_received":
      return `MobiWave Commerce received the ${String(payload.planName || "subscription")} payment for ${store}. Your plan is active.`;
  }
}

async function sendMobiWaveSms(recipient: string, message: string, reference: string) {
  const endpoint = process.env.MOBIWAVE_SMS_API_URL;
  const apiKey = process.env.MOBIWAVE_SMS_API_KEY;
  const senderId = process.env.MOBIWAVE_SMS_SENDER_ID;
  if (!endpoint || !apiKey || !senderId) throw new Error("sms_provider_not_configured");
  const url = new URL(endpoint);
  if (url.protocol !== "https:" && url.hostname !== "localhost") throw new Error("sms_provider_requires_https");

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "Idempotency-Key": reference,
    },
    body: JSON.stringify({ to: recipient, message, senderId, clientReference: reference }),
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`sms_provider_http_${response.status}`);
  const data = await response.json().catch(() => ({})) as {
    id?: string; messageId?: string; reference?: string; data?: { id?: string; messageId?: string };
  };
  return data.messageId || data.id || data.reference || data.data?.messageId || data.data?.id || reference;
}

export async function processQueuedSmsBatch(batchSize = 20) {
  if (!process.env.MOBIWAVE_SMS_API_URL || !process.env.MOBIWAVE_SMS_API_KEY || !process.env.MOBIWAVE_SMS_SENDER_ID) {
    return { claimed: 0, sent: 0, retried: 0, failed: 0, skipped: "sms_provider_not_configured" as const };
  }

  const client = await db.connect();
  let events: QueuedSms[] = [];
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.message_worker', 'true', true)");
    const due = await client.query(
      `SELECT id, store_id, recipient, template_key, dedupe_key, payload, attempt_count
         FROM message_events
        WHERE channel='sms'
          AND (
            (status='queued' AND next_attempt_at <= now())
            OR (status='processing' AND locked_at < now() - interval '10 minutes')
          )
        ORDER BY created_at
        FOR UPDATE SKIP LOCKED
        LIMIT $1`,
      [Math.max(1, Math.min(batchSize, 50))],
    );
    for (const row of due.rows as QueuedSms[]) {
      const updated = await client.query(
        "UPDATE message_events SET status='processing', attempt_count=attempt_count+1, locked_at=now(), locked_by=$1, updated_at=now() WHERE id=$2 RETURNING attempt_count",
        [process.env.MESSAGE_WORKER_ID || "mobiwave-commerce-worker", row.id],
      );
      events.push({ ...row, attempt_count: Number(updated.rows[0]?.attempt_count || row.attempt_count + 1) });
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }

  let sent = 0, retried = 0, failed = 0;
  for (const event of events) {
    const updateClient = await db.connect();
    try {
      const message = renderCommerceSms(event.template_key, event.payload || {});
      const providerReference = await sendMobiWaveSms(event.recipient, message, event.dedupe_key);
      await updateClient.query("BEGIN");
      await updateClient.query("SELECT set_config('app.message_worker', 'true', true)");
      await updateClient.query(
        "UPDATE message_events SET status='sent', provider_reference=$1, sent_at=now(), locked_at=NULL, locked_by=NULL, error_code=NULL, updated_at=now() WHERE id=$2 AND status='processing'",
        [providerReference, event.id],
      );
      await updateClient.query("COMMIT");
      sent++;
    } catch (error) {
      await updateClient.query("ROLLBACK").catch(() => undefined);
      const terminal = event.attempt_count >= 5;
      const delayMinutes = Math.min(60, 2 ** Math.min(event.attempt_count, 6));
      try {
        await updateClient.query("BEGIN");
        await updateClient.query("SELECT set_config('app.message_worker', 'true', true)");
        await updateClient.query(
          "UPDATE message_events SET status=$1, next_attempt_at=now()+($2 * interval '1 minute'), locked_at=NULL, locked_by=NULL, error_code=$3, updated_at=now() WHERE id=$4 AND status='processing'",
          [terminal ? "failed" : "queued", delayMinutes, error instanceof Error ? error.message.slice(0, 80) : "sms_delivery_failed", event.id],
        );
        await updateClient.query("COMMIT");
      } catch { await updateClient.query("ROLLBACK").catch(() => undefined); }
      if (terminal) failed++; else retried++;
    } finally {
      updateClient.release();
    }
  }
  return { claimed: events.length, sent, retried, failed };
}
