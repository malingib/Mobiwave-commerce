import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getRequestUser } from "@/lib/request-user";
import { consumeMetaOAuthState } from "@/lib/channels/oauth-state";
import {
  exchangeInstagramAuthorizationCode,
  exchangeInstagramLongLivedToken,
  getInstagramProfile,
  subscribeInstagramMessagingWebhooks,
} from "@/lib/channels/meta-oauth";
import { saveMetaChannelConnection } from "@/lib/channels/save-connection";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function redirectTo(request: Request, storeId: string | null, result: string) {
  const path = storeId
    ? `/dashboard/${encodeURIComponent(storeId)}/integrations/channels?instagram=${encodeURIComponent(result)}`
    : `/dashboard?instagram=${encodeURIComponent(result)}`;
  return NextResponse.redirect(new URL(path, request.url));
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const state = url.searchParams.get("state") || "";
  const code = url.searchParams.get("code") || "";
  const providerError = url.searchParams.get("error") || url.searchParams.get("error_reason");
  const user = await getRequestUser();
  if (!user) return NextResponse.redirect(new URL("/login", request.url));

  const client = await db.connect();
  let onboarding: Awaited<ReturnType<typeof consumeMetaOAuthState>> = null;
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.user_id',$1,true)", [user.id]);
    await client.query("SELECT set_config('app.channel_oauth','true',true)");
    onboarding = await consumeMetaOAuthState(client, state, user.id, "instagram");
    if (!onboarding) {
      await client.query("ROLLBACK");
      return redirectTo(request, null, "session_expired");
    }
    await client.query("COMMIT");
  } catch {
    await client.query("ROLLBACK").catch(() => undefined);
    return redirectTo(request, null, "callback_error");
  } finally {
    client.release();
  }

  if (providerError || !code || code.length > 4096) {
    return redirectTo(request, onboarding.storeId, "cancelled");
  }

  try {
    const redirectUri = process.env.META_INSTAGRAM_REDIRECT_URI || "";
    if (!redirectUri) throw new Error("instagram_redirect_uri_missing");
    const shortLived = await exchangeInstagramAuthorizationCode(code, redirectUri);
    const token = await exchangeInstagramLongLivedToken(shortLived.accessToken);
    const profile = await getInstagramProfile(token.accessToken);
    await subscribeInstagramMessagingWebhooks(profile.id, token.accessToken);
    const connection = await saveMetaChannelConnection({
      storeId: onboarding.storeId,
      userId: user.id,
      channel: "instagram",
      ownershipMode: onboarding.ownershipMode,
      assetOwnerType: onboarding.assetOwnerType,
      providerAccountId: profile.id,
      displayName: profile.username ? `@${profile.username}` : "Instagram Business",
      metadata: { username: profile.username, loginType: "instagram_login" },
      token: { ...token, scopes: token.scopes.length ? token.scopes : ["instagram_business_basic", "instagram_business_manage_messages"] },
    });
    return redirectTo(request, onboarding.storeId, `connected:${connection.id}`);
  } catch (error) {
    const code = error instanceof Error && /^[a-z0-9_]{1,80}$/.test(error.message)
      ? error.message
      : "meta_connection_failed";
    return redirectTo(request, onboarding.storeId, code);
  }
}
