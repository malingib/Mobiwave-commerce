import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getRequestUser } from "@/lib/request-user";
import { decryptChannelCredential } from "@/lib/channels/credentials";
import { listApprovedWhatsAppTemplates } from "@/lib/channels/meta-send";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ storeId: string; connectionId: string }> }) {
  const user = await getRequestUser();
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  const { storeId, connectionId } = await context.params;
  const client = await db.connect();
  let wabaId = "";
  let encrypted = "";
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.user_id',$1,true)", [user.id]);
    await client.query("SELECT set_config('app.channel_oauth','true',true)");
    const membership = await client.query("SELECT 1 FROM store_memberships WHERE store_id=$1 AND user_id=$2", [storeId,user.id]);
    if (!membership.rowCount) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "Store membership required" }, { status: 403 });
    }
    const result = await client.query(
      `SELECT c.channel,c.status,c.provider_account_id,cred.token_ciphertext,cred.expires_at,cred.revoked_at
         FROM channel_connections c
         JOIN channel_credentials cred ON cred.store_id=c.store_id AND cred.id=c.credential_ref
        WHERE c.store_id=$1 AND c.id=$2 LIMIT 1`,
      [storeId,connectionId],
    );
    if (!result.rowCount) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "Channel connection not found" }, { status: 404 });
    }
    const row = result.rows[0];
    if (row.channel !== "whatsapp" || row.status !== "connected" || row.revoked_at ||
        (row.expires_at && new Date(row.expires_at).getTime() <= Date.now())) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "An active WhatsApp connection is required" }, { status: 409 });
    }
    wabaId = String(row.provider_account_id || "");
    encrypted = String(row.token_ciphertext || "");
    if (!wabaId || !encrypted) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "WhatsApp account credentials are unavailable" }, { status: 409 });
    }
    await client.query("COMMIT");
  } catch {
    await client.query("ROLLBACK").catch(() => undefined);
    return NextResponse.json({ error: "Could not load WhatsApp templates" }, { status: 500 });
  } finally { client.release(); }

  try {
    const templates = await listApprovedWhatsAppTemplates(wabaId,decryptChannelCredential(encrypted));
    return NextResponse.json({ templates }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const code = error instanceof Error && /^meta_api_\d+$/.test(error.message) ? error.message : "template_list_failed";
    return NextResponse.json({ error: "Approved WhatsApp templates could not be loaded", code }, { status: 502 });
  }
}
