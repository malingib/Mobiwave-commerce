import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getRequestUser } from "@/lib/request-user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ storeId: string; conversationId: string }> };

export async function GET(_request: Request, context: Context) {
  const user = await getRequestUser();
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  const { storeId, conversationId } = await context.params;
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.user_id',$1,true)", [user.id]);
    const membership = await client.query("SELECT 1 FROM store_memberships WHERE store_id=$1 AND user_id=$2", [storeId,user.id]);
    if (!membership.rowCount) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "Store membership required" }, { status: 403 });
    }
    const conversation = await client.query(
      `SELECT c.id,c.channel,c.status,c.priority,c.unread_count,c.assigned_to,c.last_message_at,c.created_at,
              ci.display_name AS customer_name,ci.phone_e164,ci.email,ci.external_user_id,
              cc.display_name AS channel_name,cc.status AS connection_status,
              (SELECT COALESCE(m.provider_timestamp,m.created_at)
                 FROM conversation_messages m
                WHERE m.store_id=c.store_id AND m.conversation_id=c.id AND m.direction='inbound'
                ORDER BY COALESCE(m.provider_timestamp,m.created_at) DESC LIMIT 1) AS last_inbound_at
         FROM conversations c
         JOIN channel_identities ci ON ci.store_id=c.store_id AND ci.id=c.identity_id
         JOIN channel_connections cc ON cc.store_id=c.store_id AND cc.id=c.connection_id
        WHERE c.store_id=$1 AND c.id=$2 LIMIT 1`,
      [storeId,conversationId],
    );
    if (!conversation.rowCount) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
    }
    const [messages,notes] = await Promise.all([
      client.query(
        `SELECT id,direction,message_type,content,provider_status,provider_error_code,
                provider_timestamp,sent_at,delivered_at,read_at,sender_user_id,created_at
           FROM conversation_messages
          WHERE store_id=$1 AND conversation_id=$2
          ORDER BY created_at DESC,id DESC LIMIT 100`,
        [storeId,conversationId],
      ),
      client.query(
        `SELECT id,author_user_id,body,created_at FROM conversation_notes
          WHERE store_id=$1 AND conversation_id=$2
          ORDER BY created_at DESC LIMIT 50`,
        [storeId,conversationId],
      ),
    ]);
    await client.query("COMMIT");
    return NextResponse.json({
      conversation: conversation.rows[0],
      messages: messages.rows.reverse(),
      notes: notes.rows,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    await client.query("ROLLBACK").catch(() => undefined);
    return NextResponse.json({ error: "Could not load this conversation" }, { status: 500 });
  } finally { client.release(); }
}

export async function PATCH(request: Request, context: Context) {
  const user = await getRequestUser();
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  const { storeId, conversationId } = await context.params;
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid request body" }, { status: 400 }); }
  const status = body.status === undefined ? null : String(body.status);
  const priority = body.priority === undefined ? null : String(body.priority);
  const hasAssignee = Object.prototype.hasOwnProperty.call(body,"assignedTo");
  const assignedTo = hasAssignee && typeof body.assignedTo === "string" ? body.assignedTo : null;
  const markRead = body.markRead === true;
  if ((status !== null && !["open","pending","resolved","archived"].includes(status)) ||
      (priority !== null && !["low","normal","high","urgent"].includes(priority)) ||
      (hasAssignee && body.assignedTo !== null && (typeof body.assignedTo !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.assignedTo)))) {
    return NextResponse.json({ error: "Invalid conversation update" }, { status: 400 });
  }
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.user_id',$1,true)", [user.id]);
    const membership = await client.query("SELECT 1 FROM store_memberships WHERE store_id=$1 AND user_id=$2", [storeId,user.id]);
    if (!membership.rowCount) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "Store membership required" }, { status: 403 });
    }
    if (assignedTo) {
      const assignee = await client.query("SELECT 1 FROM store_memberships WHERE store_id=$1 AND user_id=$2", [storeId,assignedTo]);
      if (!assignee.rowCount) {
        await client.query("ROLLBACK");
        return NextResponse.json({ error: "Assignee must be a member of this store" }, { status: 400 });
      }
    }
    const result = await client.query(
      `UPDATE conversations
          SET status=COALESCE($3,status),
              priority=COALESCE($4,priority),
              assigned_to=CASE WHEN $5::boolean THEN $6::uuid ELSE assigned_to END,
              unread_count=CASE WHEN $7::boolean THEN 0 ELSE unread_count END,
              resolved_at=CASE
                WHEN $3='resolved' THEN COALESCE(resolved_at,now())
                WHEN $3 IN ('open','pending') THEN NULL
                ELSE resolved_at
              END,
              updated_at=now()
        WHERE store_id=$1 AND id=$2
        RETURNING id,status,priority,assigned_to,unread_count,resolved_at`,
      [storeId,conversationId,status,priority,hasAssignee,assignedTo,markRead],
    );
    if (!result.rowCount) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
    }
    await client.query("COMMIT");
    return NextResponse.json({ conversation: result.rows[0] }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    await client.query("ROLLBACK").catch(() => undefined);
    return NextResponse.json({ error: "Could not update conversation" }, { status: 500 });
  } finally { client.release(); }
}
