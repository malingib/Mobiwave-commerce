import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getRequestUser } from "@/lib/request-user";
import { decryptChannelCredential, encryptChannelCredential } from "@/lib/channels/credentials";
import { refreshInstagramLongLivedToken } from "@/lib/channels/meta-oauth";

export const runtime = "nodejs";

export async function POST(
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
    const membership = await client.query(
      "SELECT 1 FROM store_memberships WHERE store_id=$1 AND user_id=$2 AND role IN ('owner','manager')",
      [storeId, user.id],
    );
    if (!membership.rowCount) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "Store owner or manager access required" }, { status: 403 });
    }
    const result = await client.query(
      `SELECT c.channel,c.status,cred.id AS credential_id,cred.token_ciphertext,
              cred.scopes,cred.created_at,cred.expires_at,cred.revoked_at,cred.last_validated_at
         FROM channel_connections c
         JOIN channel_credentials cred
           ON cred.store_id=c.store_id AND cred.id=c.credential_ref
        WHERE c.store_id=$1 AND c.id=$2
        LIMIT 1 FOR UPDATE OF cred`,
      [storeId, connectionId],
    );
    if (!result.rowCount) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "Channel credentials not found" }, { status: 404 });
    }
    const credential = result.rows[0];
    if (credential.channel !== "instagram") {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "WhatsApp credentials must be renewed through Embedded Signup" }, { status: 409 });
    }
    if (credential.revoked_at || credential.status === "disconnected") {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "This channel is disconnected" }, { status: 409 });
    }
    if (new Date(credential.created_at).getTime() > Date.now() - 24 * 60 * 60 * 1000) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "Instagram token can be refreshed after it is at least 24 hours old" }, { status: 409 });
    }
    if (credential.last_validated_at && new Date(credential.last_validated_at).getTime() > Date.now() - 60_000) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "A token refresh is already in progress or just completed" }, { status: 409 });
    }
    if (!credential.expires_at || new Date(credential.expires_at).getTime() <= Date.now()) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "Instagram token has expired. Reconnect the account." }, { status: 409 });
    }
    const encrypted = String(credential.token_ciphertext);
    const credentialId = String(credential.credential_id);
    await client.query("UPDATE channel_credentials SET last_validated_at=now() WHERE store_id=$1 AND id=$2", [storeId, credentialId]);
    await client.query("COMMIT");

    const token = await refreshInstagramLongLivedToken(decryptChannelCredential(encrypted));
    const tokenCiphertext = encryptChannelCredential(token.accessToken);
    const expiresAt = token.expiresIn
      ? new Date(Date.now() + token.expiresIn * 1000).toISOString()
      : null;
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.user_id',$1,true)", [user.id]);
    await client.query("SELECT set_config('app.channel_oauth','true',true)");
    await client.query("SELECT set_config('app.channel_worker','true',true)");
    await client.query(
      `UPDATE channel_credentials
          SET token_ciphertext=$1,expires_at=$2,last_validated_at=now(),updated_at=now()
        WHERE store_id=$3 AND id=$4 AND revoked_at IS NULL`,
      [tokenCiphertext, expiresAt, storeId, credentialId],
    );
    await client.query(
      `UPDATE channel_connections
          SET status='connected',last_verified_at=now(),last_error_code=NULL,updated_at=now()
        WHERE store_id=$1 AND id=$2`,
      [storeId, connectionId],
    );
    await client.query(
      "INSERT INTO channel_connection_events (store_id,connection_id,event_type,actor_user_id,details) VALUES ($1,$2,'health_check',$3,$4::jsonb)",
      [storeId, connectionId, user.id, JSON.stringify({ tokenRefreshed: true })],
    );
    await client.query("COMMIT");
    return NextResponse.json({ ok: true, expiresAt }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    const code = error instanceof Error && /^meta_api_\d+$/.test(error.message) ? error.message : "token_refresh_failed";
    return NextResponse.json({ error: "Instagram token could not be refreshed", code }, { status: 502 });
  } finally {
    client.release();
  }
}
