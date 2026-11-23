import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getRequestUser } from "@/lib/request-user";
import { issueMetaOAuthState, type AssetOwnerType, type OnboardingMode } from "@/lib/channels/oauth-state";
import { getPlatformProviderConfig } from "@/lib/platform-provider-config";
import { getPlatformProviderConfig } from "@/lib/platform-provider-config";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ storeId: string }> }) {
  const user = await getRequestUser();
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  const { storeId } = await context.params;
  let body: Record<string, unknown> = {};
  try { body = await request.json(); } catch { /* defaults are intentional */ }

  const ownershipMode = body.ownershipMode === "mobiwave_managed" ? "mobiwave_managed" : "merchant_owned";
  const assetOwnerType = body.assetOwnerType === "mobiwave" ? "mobiwave" : "merchant";
  const meta = await getPlatformProviderConfig("meta");
  if (!(meta?.appId || process.env.META_APP_ID) || !(meta?.whatsappConfigId || process.env.META_WHATSAPP_CONFIG_ID) ||
      !(meta?.appSecret || process.env.META_APP_SECRET) || !process.env.CHANNEL_CREDENTIALS_ENCRYPTION_KEY) {
    return NextResponse.json({ error: "WhatsApp onboarding is not configured on the server" }, { status: 503 });
  }

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
    const state = await issueMetaOAuthState(client, {
      storeId, userId: user.id, channel: "whatsapp",
      ownershipMode: ownershipMode as OnboardingMode,
      assetOwnerType: assetOwnerType as AssetOwnerType,
    });
    await client.query("COMMIT");
    return NextResponse.json({
      appId: meta?.appId || process.env.META_APP_ID,
      configId: meta?.whatsappConfigId || process.env.META_WHATSAPP_CONFIG_ID,
      graphVersion: meta?.graphVersion || process.env.META_GRAPH_API_VERSION || "v27.0",
      state,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    await client.query("ROLLBACK").catch(() => undefined);
    return NextResponse.json({ error: "Could not start WhatsApp onboarding" }, { status: 500 });
  } finally {
    client.release();
  }
}
