import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getRequestUser } from "@/lib/request-user";
import { consumeMetaOAuthState } from "@/lib/channels/oauth-state";
import {
  exchangeWhatsAppEmbeddedSignupCode,
  getWhatsAppPhoneNumber,
  subscribeWhatsAppWebhooks,
} from "@/lib/channels/meta-oauth";
import { saveMetaChannelConnection } from "@/lib/channels/save-connection";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const user = await getRequestUser();
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  let body: Record<string, unknown>;
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: "Invalid request body" }, { status: 400 }); }

  const code = typeof body.code === "string" ? body.code.trim() : "";
  const state = typeof body.state === "string" ? body.state : "";
  const wabaId = typeof body.wabaId === "string" ? body.wabaId.trim() : "";
  const phoneNumberId = typeof body.phoneNumberId === "string" ? body.phoneNumberId.trim() : "";
  const businessId = typeof body.businessId === "string" ? body.businessId.trim() : "";
  if (!code || code.length > 4096 || !/^\d{5,30}$/.test(wabaId) || !/^\d{5,30}$/.test(phoneNumberId) ||
      (businessId && !/^\d{5,30}$/.test(businessId))) {
    return NextResponse.json({ error: "A valid Embedded Signup code, WABA ID and phone number ID are required" }, { status: 400 });
  }

  const client = await db.connect();
  let onboarding: Awaited<ReturnType<typeof consumeMetaOAuthState>> = null;
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.user_id',$1,true)", [user.id]);
    await client.query("SELECT set_config('app.channel_oauth','true',true)");
    onboarding = await consumeMetaOAuthState(client, state, user.id, "whatsapp");
    if (!onboarding) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "Onboarding session expired or already used. Start again." }, { status: 400 });
    }
    await client.query("COMMIT");
  } catch {
    await client.query("ROLLBACK").catch(() => undefined);
    return NextResponse.json({ error: "Could not validate onboarding session" }, { status: 500 });
  } finally {
    client.release();
  }

  try {
    const token = await exchangeWhatsAppEmbeddedSignupCode(code);
    const phone = await getWhatsAppPhoneNumber(wabaId, phoneNumberId, token.accessToken);
    await subscribeWhatsAppWebhooks(wabaId, token.accessToken);
    const connection = await saveMetaChannelConnection({
      storeId: onboarding.storeId,
      userId: user.id,
      channel: "whatsapp",
      ownershipMode: onboarding.ownershipMode,
      assetOwnerType: onboarding.assetOwnerType,
      providerBusinessId: businessId || null,
      providerAccountId: wabaId,
      providerAddressId: phoneNumberId,
      displayName: phone.displayPhoneNumber || phone.verifiedName || "WhatsApp Business",
      metadata: { verifiedName: phone.verifiedName },
      token,
    });
    return NextResponse.json({
      ok: true,
      connection: {
        id: connection.id,
        channel: "whatsapp",
        displayName: phone.displayPhoneNumber || phone.verifiedName || "WhatsApp Business",
        status: "connected",
      },
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const code = error instanceof Error && /^meta_api_\d+$/.test(error.message)
      ? error.message
      : error instanceof Error && /^[a-z0-9_]{1,80}$/.test(error.message)
        ? error.message
        : "meta_connection_failed";
    const status = code === "meta_account_already_connected" ? 409 : 502;
    return NextResponse.json({ error: "WhatsApp could not be connected", code }, { status });
  }
}
