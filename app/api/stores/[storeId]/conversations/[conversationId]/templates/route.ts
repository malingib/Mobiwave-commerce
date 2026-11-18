import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getRequestUser } from "@/lib/request-user";
import { decryptChannelCredential } from "@/lib/channels/credentials";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ProviderTemplate = { name?: string; language?: string; status?: string; category?: string; components?: unknown[] };
type ProviderPayload = { data?: ProviderTemplate[]; paging?: { cursors?: { after?: string } }; error?: { code?: number } };

export async function GET(_request: Request, context: { params: Promise<{ storeId: string; conversationId: string }> }) {
  const user = await getRequestUser();
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  const { storeId, conversationId } = await context.params;
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.user_id',$1,true)", [user.id]);
    const member = await client.query("SELECT 1 FROM store_memberships WHERE store_id=$1 AND user_id=$2", [storeId,user.id]);
    if (!member.rowCount) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "Store membership required" }, { status: 403 });
    }
    const result = await client.query(
      `SELECT c.channel,cc.provider_account_id,cc.provider_address_id,cc.status,
              cr.token_ciphertext,cr.expires_at,cr.scopes
         FROM conversations c
         JOIN channel_connections cc ON cc.store_id=c.store_id AND cc.id=c.connection_id
         LEFT JOIN channel_credentials cr ON cr.store_id=cc.store_id AND cr.id=cc.credential_ref
        WHERE c.store_id=$1 AND c.id=$2 LIMIT 1`,
      [storeId,conversationId],
    );
    if (!result.rowCount) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
    }
    await client.query("COMMIT");
    const connection = result.rows[0];
    if (connection.channel !== "whatsapp") return NextResponse.json({ templates: [], unsupported: true });
    if (connection.status !== "connected" || !connection.token_ciphertext) return NextResponse.json({ error: "WhatsApp channel is not connected" }, { status: 409 });
    if (connection.expires_at && new Date(connection.expires_at).getTime() <= Date.now()) return NextResponse.json({ error: "WhatsApp credential has expired" }, { status: 409 });
    if (!(connection.scopes as string[]).includes("whatsapp_business_management")) return NextResponse.json({ error: "WhatsApp template-management permission is missing. Reconnect the channel with the required permission." }, { status: 403 });
    const wabaId = String(connection.provider_account_id || "");
    if (!/^\d{5,30}$/.test(wabaId)) return NextResponse.json({ error: "WhatsApp Business Account is not configured" }, { status: 409 });
    const token = decryptChannelCredential(String(connection.token_ciphertext));
    const version = process.env.META_GRAPH_API_VERSION || "v27.0";
    if (!/^v\d+\.\d+$/.test(version)) return NextResponse.json({ error: "Invalid Meta API version configuration" }, { status: 500 });
    const url = new URL("https://graph.facebook.com/" + version + "/" + encodeURIComponent(wabaId) + "/message_templates");
    url.searchParams.set("fields", "name,status,language,category,components");
    url.searchParams.set("limit", "100");
    const response = await fetch(url, { headers: { Authorization: "Bearer " + token }, cache: "no-store", signal: AbortSignal.timeout(15000) });
    let payload: ProviderPayload;
    try { payload = await response.json() as ProviderPayload; }
    catch { return NextResponse.json({ error: "Meta returned an invalid template response" }, { status: 502 }); }
    if (!response.ok || payload.error) return NextResponse.json({ error: "Could not retrieve WhatsApp templates", code: payload.error?.code }, { status: 502 });
    const templates = (payload.data || []).filter(item => item.status === "APPROVED" && typeof item.name === "string" && typeof item.language === "string")
      .map(item => ({ name: item.name, language: item.language, category: item.category || null, components: item.components || [] }));
    return NextResponse.json({ templates, hasMore: Boolean(payload.paging?.cursors?.after) }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    await client.query("ROLLBACK").catch(() => undefined);
    return NextResponse.json({ error: "Could not load approved WhatsApp templates" }, { status: 500 });
  } finally { client.release(); }
}
