import { getPlatformProviderConfig } from "@/lib/platform-provider-config";
type JsonObject = Record<string, unknown>;

export type MetaToken = {
  accessToken: string;
  tokenType: string;
  expiresIn: number | null;
  scopes: string[];
  userId?: string;
};

export type MetaPhoneNumber = {
  id: string;
  displayPhoneNumber: string | null;
  verifiedName: string | null;
};

function graphVersion(override?: string) {
  const version = override || process.env.META_GRAPH_API_VERSION || "v27.0";
  if (!/^v\d+\.\d+$/.test(version)) throw new Error("Invalid Meta Graph API version configuration");
  return version;
}

function requiredEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

function asObject(value: unknown): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid provider response");
  return value as JsonObject;
}

async function readProviderResponse(response: Response): Promise<JsonObject> {
  let payload: JsonObject;
  try { payload = asObject(await response.json()); }
  catch { throw new Error("Meta returned an invalid response"); }
  if (!response.ok || payload.error) {
    const error = payload.error && typeof payload.error === "object" && !Array.isArray(payload.error)
      ? payload.error as JsonObject
      : {};
    const code = typeof error.code === "number" ? String(error.code) : "provider_error";
    throw new Error(`meta_api_${code}`);
  }
  return payload;
}

function tokenFrom(payload: JsonObject): MetaToken {
  const accessToken = typeof payload.access_token === "string" ? payload.access_token : "";
  if (!accessToken || accessToken.length > 16_384) throw new Error("meta_access_token_missing");
  const expires = Number(payload.expires_in);
  const scopes = typeof payload.permissions === "string"
    ? payload.permissions.split(",").filter(Boolean)
    : Array.isArray(payload.permissions)
      ? payload.permissions.filter((value): value is string => typeof value === "string")
      : [];
  return {
    accessToken,
    tokenType: typeof payload.token_type === "string" ? payload.token_type : "bearer",
    expiresIn: Number.isFinite(expires) && expires > 0 ? Math.floor(expires) : null,
    scopes,
    ...(typeof payload.user_id === "string" || typeof payload.user_id === "number"
      ? { userId: String(payload.user_id) }
      : {}),
  };
}

export function buildInstagramAuthorizationUrl(state: string, redirectUri: string, appId?: string) {
  const url = new URL("https://www.instagram.com/oauth/authorize");
  url.searchParams.set("client_id", appId || requiredEnv("META_APP_ID"));
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "instagram_business_basic,instagram_business_manage_messages");
  url.searchParams.set("state", state);
  return url.toString();
}

export async function exchangeWhatsAppEmbeddedSignupCode(code: string): Promise<MetaToken> {
  const config = (process.env.DATABASE_URL ? await getPlatformProviderConfig("meta") : null);
  const url = new URL(`https://graph.facebook.com/${graphVersion(config?.graphVersion)}/oauth/access_token`);
  url.searchParams.set("client_id", config?.appId || requiredEnv("META_APP_ID"));
  url.searchParams.set("client_secret", config?.appSecret || requiredEnv("META_APP_SECRET"));
  url.searchParams.set("code", code);
  const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(12_000) });
  return tokenFrom(await readProviderResponse(response));
}

export async function exchangeInstagramAuthorizationCode(code: string, redirectUri: string): Promise<MetaToken> {
  const config = await getPlatformProviderConfig("meta");
  const body = new URLSearchParams({
    client_id: config?.appId || requiredEnv("META_APP_ID"),
    client_secret: config?.appSecret || requiredEnv("META_APP_SECRET"),
    grant_type: "authorization_code",
    redirect_uri: redirectUri,
    code,
  });
  const response = await fetch("https://api.instagram.com/oauth/access_token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    cache: "no-store",
    signal: AbortSignal.timeout(12_000),
  });
  return tokenFrom(await readProviderResponse(response));
}

export async function exchangeInstagramLongLivedToken(shortLivedToken: string): Promise<MetaToken> {
  const config = await getPlatformProviderConfig("meta");
  const url = new URL("https://graph.instagram.com/access_token");
  url.searchParams.set("grant_type", "ig_exchange_token");
  url.searchParams.set("client_secret", config?.appSecret || requiredEnv("META_APP_SECRET"));
  url.searchParams.set("access_token", shortLivedToken);
  const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(12_000) });
  return tokenFrom(await readProviderResponse(response));
}

export async function refreshInstagramLongLivedToken(accessToken: string): Promise<MetaToken> {
  const url = new URL("https://graph.instagram.com/refresh_access_token");
  url.searchParams.set("grant_type", "ig_refresh_token");
  url.searchParams.set("access_token", accessToken);
  const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(12_000) });
  return tokenFrom(await readProviderResponse(response));
}

export async function getInstagramProfile(accessToken: string) {
  const url = new URL("https://graph.instagram.com/me");
  url.searchParams.set("fields", "user_id,username");
  url.searchParams.set("access_token", accessToken);
  const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(12_000) });
  const payload = await readProviderResponse(response);
  const id = payload.user_id ?? payload.id;
  if (typeof id !== "string" && typeof id !== "number") throw new Error("instagram_account_id_missing");
  return { id: String(id), username: typeof payload.username === "string" ? payload.username : null };
}

export async function subscribeInstagramMessagingWebhooks(accountId: string, accessToken: string) {
  const url = new URL(`https://graph.instagram.com/${encodeURIComponent(accountId)}/subscribed_apps`);
  url.searchParams.set("subscribed_fields", "messages");
  url.searchParams.set("access_token", accessToken);
  const response = await fetch(url, {
    method: "POST",
    cache: "no-store",
    signal: AbortSignal.timeout(12_000),
  });
  await readProviderResponse(response);
}

export async function getWhatsAppPhoneNumber(wabaId: string, phoneNumberId: string, accessToken: string): Promise<MetaPhoneNumber> {
  const config = await getPlatformProviderConfig("meta");
  const url = new URL(`https://graph.facebook.com/${graphVersion(config?.graphVersion)}/${encodeURIComponent(wabaId)}/phone_numbers`);
  url.searchParams.set("fields", "id,display_phone_number,verified_name");
  url.searchParams.set("access_token", accessToken);
  const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(12_000) });
  const payload = await readProviderResponse(response);
  const data = Array.isArray(payload.data) ? payload.data : [];
  const phone = data.find(value => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    return String((value as JsonObject).id || "") === phoneNumberId;
  });
  if (!phone || typeof phone !== "object" || Array.isArray(phone)) throw new Error("whatsapp_phone_not_in_waba");
  const item = phone as JsonObject;
  return {
    id: phoneNumberId,
    displayPhoneNumber: typeof item.display_phone_number === "string" ? item.display_phone_number : null,
    verifiedName: typeof item.verified_name === "string" ? item.verified_name : null,
  };
}

export async function subscribeWhatsAppWebhooks(wabaId: string, accessToken: string) {
  const config = await getPlatformProviderConfig("meta");
  const url = new URL(`https://graph.facebook.com/${graphVersion(config?.graphVersion)}/${encodeURIComponent(wabaId)}/subscribed_apps`);
  url.searchParams.set("access_token", accessToken);
  const response = await fetch(url, {
    method: "POST",
    cache: "no-store",
    signal: AbortSignal.timeout(12_000),
  });
  await readProviderResponse(response);
}
