import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getRequestUser } from "@/lib/request-user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ storeId: string }> }) {
  const user = await getRequestUser();
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  const { storeId } = await context.params;
  const url = new URL(request.url);
  const status = url.searchParams.get("status") || "all";
  const channel = url.searchParams.get("channel") || "all";
  if (!["all","open","pending","resolved","archived"].includes(status) ||
      !["all","whatsapp","instagram","website","email","sms"].includes(channel)) {
    return NextResponse.json({ error: "Invalid inbox filter" }, { status: 400 });
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
    const result = await client.query(
      `SELECT c.id,c.channel,c.status,c.priority,c.unread_count,c.assigned_to,c.last_message_at,c.updated_at,
              ci.display_name AS customer_name,ci.phone_e164,ci.external_user_id,
              cc.display_name AS channel_name,
              latest.content AS last_message,latest.direction AS last_direction,
              latest.provider_status AS last_provider_status,latest.created_at AS last_message_created_at
         FROM conversations c
         JOIN channel_identities ci ON ci.store_id=c.store_id AND ci.id=c.identity_id
         JOIN channel_connections cc ON cc.store_id=c.store_id AND cc.id=c.connection_id
         LEFT JOIN LATERAL (
           SELECT content,direction,provider_status,created_at
             FROM conversation_messages m
            WHERE m.store_id=c.store_id AND m.conversation_id=c.id
            ORDER BY m.created_at DESC,m.id DESC LIMIT 1
         ) latest ON true
        WHERE c.store_id=$1
          AND ($2='all' OR c.status=$2)
          AND ($3='all' OR c.channel=$3)
        ORDER BY c.last_message_at DESC NULLS LAST,c.updated_at DESC
        LIMIT 100`,
      [storeId,status,channel],
    );
    await client.query("COMMIT");
    return NextResponse.json({ conversations: result.rows }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    await client.query("ROLLBACK").catch(() => undefined);
    return NextResponse.json({ error: "Could not load conversations" }, { status: 500 });
  } finally { client.release(); }
}
