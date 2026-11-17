import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getRequestUser } from "@/lib/request-user";

export const runtime = "nodejs";

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ storeId: string; connectionId: string }> },
) {
  const user = await getRequestUser();
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  const { storeId, connectionId } = await context.params;
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.user_id',$1,true)", [user.id]);
    await client.query("SELECT set_config('app.channel_oauth','true',true)");
    await client.query("SELECT set_config('app.channel_worker','true',true)");
    const membership = await client.query(
      "SELECT 1 FROM store_memberships WHERE store_id=$1 AND user_id=$2 AND role IN ('owner','manager')",
      [storeId, user.id],
    );
    if (!membership.rowCount) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "Store owner or manager access required" }, { status: 403 });
    }
    const connection = await client.query(
      "SELECT id,credential_ref,channel,status FROM channel_connections WHERE store_id=$1 AND id=$2 LIMIT 1",
      [storeId, connectionId],
    );
    if (!connection.rowCount) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "Channel connection not found" }, { status: 404 });
    }
    const credentialRef = connection.rows[0].credential_ref;
    if (credentialRef) {
      await client.query(
        \`UPDATE channel_credentials
            SET token_ciphertext='',refresh_token_ciphertext=NULL,revoked_at=now(),updated_at=now()
          WHERE store_id=$1 AND id=$2\`,
        [storeId, credentialRef],
      );
    }
    await client.query(
      \`UPDATE channel_connections
          SET status='disconnected',disconnected_at=now(),credential_ref=NULL,updated_at=now()
        WHERE store_id=$1 AND id=$2\`,
      [storeId, connectionId],
    );
    await client.query(
      \`INSERT INTO channel_connection_events (store_id,connection_id,event_type,actor_user_id,details)
       VALUES ($1,$2,'disconnected',$3,$4::jsonb)\`,
      [storeId, connectionId, user.id, JSON.stringify({ channel: connection.rows[0].channel, localCredentialRevoked: true })],
    );
    await client.query("COMMIT");
    return NextResponse.json({ ok: true, status: "disconnected" }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    await client.query("ROLLBACK").catch(() => undefined);
    return NextResponse.json({ error: "Could not disconnect this channel" }, { status: 500 });
  } finally {
    client.release();
  }
}
