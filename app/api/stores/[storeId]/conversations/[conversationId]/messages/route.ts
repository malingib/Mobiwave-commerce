import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getRequestUser } from "@/lib/request-user";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ storeId: string; conversationId: string }> }) {
  const user = await getRequestUser();
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  const { storeId, conversationId } = await context.params;
  const idempotencyKey = request.headers.get("idempotency-key")?.trim() || "";
  if (!/^[A-Za-z0-9._:-]{8,128}$/.test(idempotencyKey)) {
    return NextResponse.json({ error: "A valid Idempotency-Key header is required" }, { status: 400 });
  }
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid request body" }, { status: 400 }); }
  const messageText = typeof body.text === "string" ? body.text.trim() : "";
  if (!messageText || messageText.length > 4096) return NextResponse.json({ error: "Message text must contain 1–4096 characters" }, { status: 400 });

  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.user_id',$1,true)", [user.id]);
    const membership = await client.query("SELECT 1 FROM store_memberships WHERE store_id=$1 AND user_id=$2", [storeId, user.id]);
    if (!membership.rowCount) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "Store membership required" }, { status: 403 });
    }
    const conversation = await client.query(
      \`SELECT c.id,c.store_id,c.connection_id,c.channel,cc.status AS connection_status,
              (SELECT COALESCE(m.provider_timestamp,m.created_at)
                 FROM conversation_messages m
                WHERE m.store_id=c.store_id AND m.conversation_id=c.id AND m.direction='inbound'
                ORDER BY COALESCE(m.provider_timestamp,m.created_at) DESC LIMIT 1) AS last_inbound_at
         FROM conversations c
         JOIN channel_connections cc ON cc.store_id=c.store_id AND cc.id=c.connection_id
        WHERE c.store_id=$1 AND c.id=$2 LIMIT 1 FOR UPDATE OF c\`,
      [storeId, conversationId],
    );
    if (!conversation.rowCount) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
    }
    const item = conversation.rows[0];
    if (!["whatsapp","instagram"].includes(String(item.channel)) || item.connection_status !== "connected") {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "This channel is not connected for outbound messaging" }, { status: 409 });
    }
    const lastInbound = item.last_inbound_at ? new Date(item.last_inbound_at).getTime() : 0;
    if (!lastInbound || !Number.isFinite(lastInbound) || Date.now() - lastInbound > 24 * 60 * 60 * 1000) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "The customer messaging window has expired. Approved template messaging is not yet enabled." }, { status: 409 });
    }

    const requestHash = createHash("sha256").update(JSON.stringify({ channel: item.channel, conversationId, text: messageText })).digest("hex");
    const existing = await client.query(
      "SELECT id,message_id,status,request_hash FROM message_outbox WHERE store_id=$1 AND idempotency_key=$2 LIMIT 1",
      [storeId, idempotencyKey],
    );
    if (existing.rowCount) {
      const row = existing.rows[0];
      await client.query("COMMIT");
      if (row.request_hash !== requestHash) return NextResponse.json({ error: "Idempotency key was already used for a different message" }, { status: 409 });
      return NextResponse.json({ ok: true, duplicate: true, outboxId: row.id, messageId: row.message_id, status: row.status }, { status: 202, headers: { "Cache-Control": "no-store" } });
    }

    const message = await client.query(
      \`INSERT INTO conversation_messages (store_id,conversation_id,connection_id,direction,message_type,content,provider_status,sender_user_id)
       VALUES ($1,$2,$3,'outbound','text',$4,'queued',$5) RETURNING id\`,
      [storeId, conversationId, item.connection_id, messageText, user.id],
    );
    const messageId = String(message.rows[0].id);
    const queued = await client.query(
      \`INSERT INTO message_outbox (store_id,connection_id,conversation_id,message_id,idempotency_key,request_hash,status)
       VALUES ($1,$2,$3,$4,$5,$6,'queued') ON CONFLICT (store_id,idempotency_key) DO NOTHING RETURNING id,status\`,
      [storeId, item.connection_id, conversationId, messageId, idempotencyKey, requestHash],
    );
    if (!queued.rowCount) {
      await client.query("DELETE FROM conversation_messages WHERE store_id=$1 AND id=$2", [storeId, messageId]);
      const raced = await client.query("SELECT id,message_id,status,request_hash FROM message_outbox WHERE store_id=$1 AND idempotency_key=$2", [storeId, idempotencyKey]);
      const row = raced.rows[0];
      await client.query("COMMIT");
      if (!row || row.request_hash !== requestHash) return NextResponse.json({ error: "Idempotency key conflict" }, { status: 409 });
      return NextResponse.json({ ok: true, duplicate: true, outboxId: row.id, messageId: row.message_id, status: row.status }, { status: 202, headers: { "Cache-Control": "no-store" } });
    }
    await client.query("COMMIT");
    return NextResponse.json({ ok: true, duplicate: false, outboxId: queued.rows[0].id, messageId, status: "queued" }, { status: 202, headers: { "Cache-Control": "no-store" } });
  } catch {
    await client.query("ROLLBACK").catch(() => undefined);
    return NextResponse.json({ error: "Message could not be queued" }, { status: 500 });
  } finally {
    client.release();
  }
}
