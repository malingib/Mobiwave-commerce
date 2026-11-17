import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getRequestUser } from "@/lib/request-user";
import { buildInstagramAuthorizationUrl } from "@/lib/channels/meta-oauth";
import { issueMetaOAuthState, type AssetOwnerType, type OnboardingMode } from "@/lib/channels/oauth-state";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ storeId: string }> }) {
  const user = await getRequestUser();
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  const { storeId } = await context.params;
  let body: Record<string, unknown> = {};
  try { body = await request.json(); } catch { /* defaults are intentional */ }
  const ownershipMode = body.ownershipMode === "mobiwave_managed" ? "mobiwave_managed" : "merchant_owned";
  const assetOwnerType = body.assetOwnerType === "mobiwave" ? "mobiwave" : "merchant";
  const redirectUri = process.env.META_INSTAGRAM_REDIRECT_URI || "";
  if (!process.env.META_INSTAGRAM_APP_ID || !process.env.META_INSTAGRAM_APP_SECRET ||
      !redirectUri || !process.env.CHANNEL_CREDENTIALS_ENCRYPTION_KEY) {
    return NextResponse.json({ error: "Instagram onboarding is not configured on the server" }, { status: 503 });
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
      storeId, userId: user.id, channel: "instagram",
      ownershipMode: ownershipMode as OnboardingMode,
      assetOwnerType: assetOwnerType as AssetOwnerType,
    });
    await client.query("COMMIT");
    return NextResponse.json({
      authorizationUrl: buildInstagramAuthorizationUrl(state, redirectUri),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    await client.query("ROLLBACK").catch(() => undefined);
    return NextResponse.json({ error: "Could not start Instagram onboarding" }, { status: 500 });
  } finally {
    client.release();
  }
}
