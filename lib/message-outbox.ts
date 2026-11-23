import { createHash, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { db } from "@/lib/db";
import { normalizeKenyanPhone } from "@/lib/mpesa-utils";
import { getPlatformProviderConfig } from "@/lib/platform-provider-config";

type SmsEventInput = {
  storeId: string; orderId?: string | null; recipient: string;
  templateKey: "order_received" | "order_status" | "order_payment_received" | "order_payment_failed" | "subscription_payment_received";
  dedupeKey: string; payload: Record<string, unknown>;
};
type QueuedSms = {
  id: string; store_id: string; recipient: string; template_key: SmsEventInput["templateKey"];
  dedupe_key: string; payload: Record<string, unknown>; attempt_count: number; lease_token: string;
};
export class SmsProviderError extends Error {
  constructor(readonly kind: "retryable_rejection" | "permanent_rejection" | "ambiguous", readonly code: string, readonly retryAfterSeconds?: number) {
    super(code); this.name = "SmsProviderError";
  }
}
export function stableSmsProviderKey(storeId: string, dedupeKey: string) {
  return createHash("sha256").update("mobiwave-commerce:sms:v1:").update(storeId).update(":").update(dedupeKey).digest("hex");
}
export async function enqueueSms(client: PoolClient, event: SmsEventInput) {
  const recipient = normalizeKenyanPhone(event.recipient);
  if (!recipient) return { queued: false as const, reason: "invalid_recipient" as const };
  if (!event.storeId || !event.dedupeKey.trim() || event.dedupeKey.length > 180) throw new Error("invalid_sms_idempotency_input");
  if (!event.payload || typeof event.payload !== "object" || Array.isArray(event.payload)) throw new Error("invalid_sms_payload");
  const result = await client.query(
    "INSERT INTO message_events (store_id,order_id,channel,recipient,template_key,status,dedupe_key,payload) " +
    "VALUES ($1,$2,'sms',$3,$4,'queued',$5,$6::jsonb) " +
    "ON CONFLICT (store_id,dedupe_key) DO UPDATE SET dedupe_key=EXCLUDED.dedupe_key " +
    "WHERE message_events.channel='sms' AND message_events.order_id IS NOT DISTINCT FROM EXCLUDED.order_id " +
    "AND message_events.recipient=EXCLUDED.recipient AND message_events.template_key=EXCLUDED.template_key " +
    "AND message_events.payload=EXCLUDED.payload RETURNING id",
    [event.storeId,event.orderId || null,recipient,event.templateKey,event.dedupeKey,JSON.stringify(event.payload)],
  );
  if (!result.rowCount) throw new Error("sms_idempotency_conflict");
  return { queued: true as const, id: result.rows[0].id, inserted: result.command === "INSERT" };
}
export function renderCommerceSms(templateKey: SmsEventInput["templateKey"], payload: Record<string, unknown>) {
  const store = String(payload.storeName || "the store").slice(0, 80);
  const customer = String(payload.customerName || "Customer").slice(0, 60);
  const order = String(payload.orderNumber || "").slice(0, 32);
  switch (templateKey) {
    case "order_received": {
      const amount = (Number(payload.totalMinor) / 100).toLocaleString("en-KE", { maximumFractionDigits: 2 });
      return "Hi " + customer + ", " + store + " received order #" + order + ". Total: " + String(payload.currency || "KES") + " " + amount + ". Thank you.";
    }
    case "order_status": return "Hi " + customer + ", order #" + order + " from " + store + " is now " + String(payload.status || "updated") + ".";
    case "order_payment_received": return "Hi " + customer + ", payment for order #" + order + " at " + store + " is confirmed. M-Pesa receipt: " + String(payload.receipt || "").slice(0, 20) + ".";
    case "order_payment_failed": return "Hi " + customer + ", payment for order #" + order + " at " + store + " was not confirmed. If you were charged, contact the store before paying again.";
    case "subscription_payment_received": return "MobiWave Commerce received the " + String(payload.planName || "subscription") + " payment for " + store + ". Your plan is active.";
  }
}
export async function sendMobiWaveSms(recipient: string, message: string, reference: string, providerConfig?: { apiUrl: string; apiKey: string; senderId: string }) {
  const saved = providerConfig || (process.env.DATABASE_URL ? await getPlatformProviderConfig("mobiwave_sms") : null);
  const configuredUrl = saved?.apiUrl || process.env.MOBIWAVE_SMS_API_URL || "https://sms.mobiwave.co.ke/api/v3";
  const apiKey = saved?.apiKey || process.env.MOBIWAVE_SMS_API_KEY;
  const senderId = saved?.senderId || process.env.MOBIWAVE_SMS_SENDER_ID;
  if (!apiKey || !senderId) throw new SmsProviderError("permanent_rejection", "sms_provider_not_configured");
  if (senderId.length > 11) throw new SmsProviderError("permanent_rejection", "sms_sender_id_too_long");
  let url: URL;
  try { url = new URL(configuredUrl); } catch { throw new SmsProviderError("permanent_rejection", "sms_provider_url_invalid"); }
  if (url.protocol !== "https:" && url.hostname !== "localhost") throw new SmsProviderError("permanent_rejection", "sms_provider_requires_https");
  while (url.pathname.endsWith("/")) url.pathname = url.pathname.slice(0, -1);
  const path = url.pathname;
  url.pathname = path.endsWith("/sms/send") ? path : path + "/sms/send";
  let response: Response;
  try {
    response = await fetch(url, {
      method:"POST",
      headers:{Authorization:"Bearer " + apiKey,"Content-Type":"application/json",Accept:"application/json","Idempotency-Key":reference},
      body:JSON.stringify({recipient,sender_id:senderId,type:"plain",message}),
      cache:"no-store",signal:AbortSignal.timeout(10_000),
    });
  } catch { throw new SmsProviderError("ambiguous","sms_provider_network_outcome_unknown"); }
  if (response.status === 429) {
    const retryAfter = Number(response.headers.get("retry-after"));
    throw new SmsProviderError("retryable_rejection","sms_provider_rate_limited",
      Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(3600,Math.floor(retryAfter)) : undefined);
  }
  if (response.status === 408 || response.status >= 500) throw new SmsProviderError("ambiguous","sms_provider_http_" + response.status + "_outcome_unknown");
  if (!response.ok) throw new SmsProviderError("permanent_rejection","sms_provider_http_" + response.status);
  let data: {status?:string;data?:{uid?:string}} | null = null;
  try { data = await response.json() as {status?:string;data?:{uid?:string}}; }
  catch { throw new SmsProviderError("ambiguous","sms_provider_response_unreadable"); }
  if (data?.status !== "success") throw new SmsProviderError("permanent_rejection","sms_provider_rejected");
  return data.data?.uid || reference;
}
async function updateDeliveryState(client: PoolClient, event: QueuedSms, state: "sent"|"queued"|"failed"|"delivery_unknown",
  options: {providerReference?:string;errorCode?:string;delaySeconds?:number} = {}) {
  await client.query("BEGIN");
  try {
    await client.query("SELECT set_config('app.message_worker','true',true)");
    const result = await client.query(
      "UPDATE message_events SET status=$1,provider_reference=COALESCE($2,provider_reference)," +
      "sent_at=CASE WHEN $1='sent' THEN now() ELSE sent_at END," +
      "delivery_unknown_at=CASE WHEN $1='delivery_unknown' THEN now() ELSE delivery_unknown_at END," +
      "next_attempt_at=CASE WHEN $1='queued' THEN now()+($3::int*interval '1 second') ELSE next_attempt_at END," +
      "locked_at=NULL,locked_by=NULL,error_code=$4,updated_at=now() " +
      "WHERE id=$5 AND lease_token=$6 AND status IN ('processing','delivery_unknown') RETURNING id",
      [state,options.providerReference || null,options.delaySeconds || 0,options.errorCode || null,event.id,event.lease_token],
    );
    await client.query("COMMIT");
    return result.rowCount === 1;
  } catch(error) { await client.query("ROLLBACK").catch(()=>undefined); throw error; }
}
export async function processQueuedSmsBatch(batchSize = 20) {
  const saved = process.env.DATABASE_URL ? await getPlatformProviderConfig("mobiwave_sms") : null;
  const providerConfig = saved?.apiUrl && saved.apiKey && saved.senderId ? {apiUrl:saved.apiUrl,apiKey:saved.apiKey,senderId:saved.senderId} : null;
  if (!providerConfig && (!process.env.MOBIWAVE_SMS_API_KEY || !process.env.MOBIWAVE_SMS_SENDER_ID))
    return {claimed:0,sent:0,retried:0,failed:0,deliveryUnknown:0,skipped:"sms_provider_not_configured" as const};
  const client = await db.connect();
  const events: QueuedSms[] = [];
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.message_worker','true',true)");
    await client.query(
      "UPDATE message_events SET status='delivery_unknown',delivery_unknown_at=COALESCE(delivery_unknown_at,now())," +
      "error_code='sms_worker_lease_expired',locked_at=NULL,locked_by=NULL,updated_at=now() " +
      "WHERE channel='sms' AND status='processing' AND locked_at<now()-interval '2 minutes'",
    );
    const due = await client.query(
      "SELECT id,store_id,recipient,template_key,dedupe_key,payload,attempt_count FROM message_events " +
      "WHERE channel='sms' AND status='queued' AND next_attempt_at<=now() ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT $1",
      [Math.max(1,Math.min(Math.floor(batchSize)||20,50))],
    );
    for (const row of due.rows as Omit<QueuedSms,"lease_token">[]) {
      const leaseToken = randomUUID();
      const updated = await client.query(
        "UPDATE message_events SET status='processing',attempt_count=attempt_count+1,last_attempt_at=now(),locked_at=now()," +
        "locked_by=$1,lease_token=$2,updated_at=now() WHERE id=$3 AND status='queued' RETURNING attempt_count",
        [(process.env.MESSAGE_WORKER_ID || "mobiwave-commerce-worker").slice(0,100),leaseToken,row.id],
      );
      if (updated.rowCount) events.push({...row,attempt_count:Number(updated.rows[0].attempt_count),lease_token:leaseToken});
    }
    await client.query("COMMIT");
  } catch(error) { await client.query("ROLLBACK").catch(()=>undefined); throw error; }
  finally { client.release(); }

  let sent=0,retried=0,failed=0,deliveryUnknown=0;
  for (const event of events) {
    const updateClient = await db.connect();
    let providerAccepted = false;
    try {
      const message = renderCommerceSms(event.template_key,event.payload || {});
      const key = stableSmsProviderKey(event.store_id,event.dedupe_key);
      const providerReference = await sendMobiWaveSms(event.recipient,message,key,providerConfig || undefined);
      providerAccepted = true;
      const recorded = await updateDeliveryState(updateClient,event,"sent",{providerReference});
      if (recorded) sent++; else deliveryUnknown++;
    } catch(error) {
      const failure = error instanceof SmsProviderError ? error :
        new SmsProviderError("ambiguous",providerAccepted ? "sms_provider_accepted_state_unconfirmed" : "sms_delivery_outcome_unknown");
      try {
        if (failure.kind === "ambiguous") {
          await updateDeliveryState(updateClient,event,"delivery_unknown",{errorCode:failure.code}); deliveryUnknown++;
        } else if (failure.kind === "retryable_rejection" && event.attempt_count < 8) {
          const exp = Math.min(3600,30*(2**Math.min(event.attempt_count-1,7)));
          const delay = failure.retryAfterSeconds ?? exp + Math.floor(Math.random()*10);
          await updateDeliveryState(updateClient,event,"queued",{errorCode:failure.code,delaySeconds:delay}); retried++;
        } else {
          await updateDeliveryState(updateClient,event,"failed",{errorCode:failure.code}); failed++;
        }
      } catch { deliveryUnknown++; }
    } finally { updateClient.release(); }
  }
  return {claimed:events.length,sent,retried,failed,deliveryUnknown};
}
