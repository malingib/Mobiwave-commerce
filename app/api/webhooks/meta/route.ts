import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { normalizeMetaWebhook } from "@/lib/channels/meta-adapter";
import { verifyMetaWebhookSignature } from "@/lib/channels/meta-signature";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function constantTimeMatch(expected: string, supplied: string) {
  const a = Buffer.from(expected);
  const b = Buffer.from(supplied);
  return a.length > 0 && a.length === b.length && timingSafeEqual(a, b);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const mode = url.searchParams.get("hub.mode") || url.searchParams.get("hub[mode]");
  const token = url.searchParams.get("hub.verify_token") || url.searchParams.get("hub[verify_token]") || "";
  const challenge = url.searchParams.get("hub.challenge") || url.searchParams.get("hub[challenge]") || "";
  const expected = process.env.META_WEBHOOK_VERIFY_TOKEN || "";
  if (mode !== "subscribe" || !expected || !constantTimeMatch(expected, token) || !challenge) {
    return new NextResponse("Forbidden", { status: 403 });
  }
  return new NextResponse(challenge, {
    status: 200,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });
}

export async function POST(request: Request) {
  const appSecret = process.env.META_APP_SECRET || "";
  if (!appSecret) return NextResponse.json({ error: "Webhook is not configured" }, { status: 503 });

  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > 1_048_576) return NextResponse.json({ error: "Payload too large" }, { status: 413 });

  const rawBody = await request.text();
  if (Buffer.byteLength(rawBody, "utf8") > 1_048_576) {
    return NextResponse.json({ error: "Payload too large" }, { status: 413 });
  }
  if (!verifyMetaWebhookSignature(rawBody, request.headers.get("x-hub-signature-256"), appSecret)) {
    return NextResponse.json({ error: "Invalid webhook signature" }, { status: 401 });
  }

  let payload: unknown;
  try { payload = JSON.parse(rawBody); } catch {
    return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
  }
  const events = normalizeMetaWebhook(payload);
  if (!events.length) return NextResponse.json({ accepted: 0, ignored: true });

  const client = await db.connect();
  let accepted = 0;
  let unmatched = 0;
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.channel_worker', 'true', true)");
    for (const event of events) {
      const connection = await client.query(
        `SELECT id, store_id FROM channel_connections
          WHERE channel = $1 AND (provider_account_id = $2 OR ($3::text IS NOT NULL AND provider_address_id = $3))
            AND status IN ('connected', 'reauthorization_required')
          LIMIT 1`,
        [event.channel, event.providerAccountId, event.providerAddressId],
      );
      if (!connection.rowCount) {
        unmatched++;
        continue;
      }
      const result = await client.query(
        `INSERT INTO channel_webhook_events
          (store_id, connection_id, provider_event_id, event_type, payload, signature_valid)
         VALUES ($1,$2,$3,$4,$5::jsonb,true)
         ON CONFLICT DO NOTHING`,
        [connection.rows[0].store_id, connection.rows[0].id, event.providerEventId, event.eventType, JSON.stringify(event.payload)],
      );
      accepted += result.rowCount || 0;
    }
    await client.query("COMMIT");
    return NextResponse.json({ accepted, unmatched }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    await client.query("ROLLBACK").catch(() => undefined);
    return NextResponse.json({ error: "Webhook could not be queued" }, { status: 500 });
  } finally {
    client.release();
  }
}
