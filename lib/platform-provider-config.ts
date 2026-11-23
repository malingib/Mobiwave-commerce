import { isIP } from "node:net";
import { db } from "@/lib/db";
import { decryptChannelCredential, encryptChannelCredential } from "@/lib/channels/credentials";

export type ProviderName = "meta" | "mobiwave_sms" | "r2" | "media_scanner";
export type ProviderStatus = "not_configured" | "configured" | "verified" | "error";
export type ProviderConfig = Record<string, string>;

const ALLOWED: Record<ProviderName, string[]> = {
  meta: ["appId", "appSecret", "whatsappConfigId", "graphVersion", "instagramRedirectUri", "webhookVerifyToken"],
  mobiwave_sms: ["apiUrl", "apiKey", "senderId"],
  r2: ["accountId", "endpoint", "bucketName", "accessKeyId", "secretAccessKey"],
  media_scanner: ["provider", "scannerUrl", "scannerToken"],
};

const REQUIRED: Record<ProviderName, string[]> = {
  meta: ["appId", "appSecret", "whatsappConfigId", "graphVersion", "instagramRedirectUri", "webhookVerifyToken"],
  mobiwave_sms: ["apiUrl", "apiKey", "senderId"],
  r2: ["accountId", "endpoint", "bucketName", "accessKeyId", "secretAccessKey"],
  media_scanner: ["provider", "scannerUrl", "scannerToken"],
};

export function validateProviderConfig(provider: ProviderName, config: ProviderConfig) {
  if (!REQUIRED[provider]) throw new Error("unsupported_provider");
  for (const key of REQUIRED[provider]) if (!config[key]?.trim()) throw new Error(`missing_${key}`);
  if (provider === "meta") {
    if (!/^\d+$/.test(config.appId) || !/^v\d+\.\d+$/.test(config.graphVersion)) throw new Error("invalid_meta_configuration");
    if (new URL(config.instagramRedirectUri).protocol !== "https:") throw new Error("instagram_redirect_requires_https");
  }
  if (provider === "mobiwave_sms") {
    const url = new URL(config.apiUrl);
    if (url.protocol !== "https:" || url.hostname !== "sms.mobiwave.co.ke" || url.port || url.username || url.password || url.search || url.hash) throw new Error("sms_api_endpoint_rejected");
    if (config.senderId.length > 11) throw new Error("sms_sender_id_too_long");
  }
  if (provider === "r2") {
    const endpoint = new URL(config.endpoint);
    if (endpoint.protocol !== "https:" || endpoint.hostname !== config.accountId + ".r2.cloudflarestorage.com" || endpoint.pathname !== "/" && endpoint.pathname !== "" || endpoint.port || endpoint.search || endpoint.hash) throw new Error("r2_endpoint_rejected");
  }
  if (provider === "media_scanner") {
    const scanner = new URL(config.scannerUrl);
    const host = scanner.hostname.toLowerCase();
    if (scanner.protocol !== "https:" || scanner.port || scanner.username || scanner.password || scanner.search || scanner.hash ||
        isIP(host) || !host.includes(".") || host === "localhost" || host.endsWith(".local") || host.endsWith(".internal") || host === "metadata.google.internal") {
      throw new Error("scanner_url_rejected");
    }
    if (config.provider !== "custom" && config.provider !== "cloudmersive") throw new Error("unsupported_scanner_provider");
  }
}

function decryptConfig(value: Record<string,string>): ProviderConfig {
  return Object.fromEntries(Object.entries(value).map(([key, encrypted]) => [key, decryptChannelCredential(encrypted)]));
}

export async function savePlatformProviderConfig(provider: ProviderName, updates: ProviderConfig, userId: string, source: "dashboard" | "environment" = "dashboard") {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.admin','true',true)");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", ["platform-provider:" + provider]);
    for (const key of Object.keys(updates)) if (!ALLOWED[provider].includes(key)) throw new Error("unsupported_provider_field");
    // Lock the provider row so simultaneous partial rotations cannot overwrite
    // one another or temporarily discard credentials omitted by the form.
    const current = await client.query(
      "SELECT config_ciphertext FROM platform_provider_configurations WHERE provider=$1 FOR UPDATE",
      [provider],
    );
    const previous = current.rowCount ? decryptConfig(current.rows[0].config_ciphertext as Record<string,string>) : {};
    const merged = { ...previous, ...updates };
    validateProviderConfig(provider, merged);
    const encrypted = Object.fromEntries(Object.entries(merged).map(([key, value]) => [key, encryptChannelCredential(value)]));
    await client.query(
      `INSERT INTO platform_provider_configurations(provider,config_ciphertext,status,last_error_code,version,updated_by)
       VALUES ($1,$2::jsonb,'configured',NULL,1,$3)
       ON CONFLICT(provider) DO UPDATE SET config_ciphertext=EXCLUDED.config_ciphertext,
         status='configured',last_error_code=NULL,version=platform_provider_configurations.version+1,
         updated_by=EXCLUDED.updated_by,updated_at=now()`,
      [provider, JSON.stringify(encrypted), userId],
    );
    await client.query(
      "INSERT INTO audit_events(actor_user_id,action,resource_type,metadata) VALUES($1,$2,'platform_provider_configuration',$3::jsonb)",
      [userId, `provider.${provider}.${source === "environment" ? "credentials_imported_from_environment" : "credentials_replaced"}`, JSON.stringify({ provider, source, fields: Object.keys(updates), version: current.rowCount ? "incremented" : "1" })],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally { client.release(); }
}

export async function getPlatformProviderConfig(provider: ProviderName): Promise<ProviderConfig | null> {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.provider_config_read','true',true)");
    const result = await client.query(
      "SELECT config_ciphertext FROM platform_provider_configurations WHERE provider=$1 AND status <> 'not_configured'",
      [provider],
    );
    await client.query("COMMIT");
    if (!result.rowCount) return null;
    return decryptConfig(result.rows[0].config_ciphertext as Record<string,string>);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally { client.release(); }
}

export async function getPlatformProviderStatuses() {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.admin','true',true)");
    const result = await client.query(
      "SELECT provider,status,last_verified_at,last_error_code,version,updated_at,(config_ciphertext <> '{}'::jsonb) AS credentials_saved FROM platform_provider_configurations ORDER BY provider",
    );
    await client.query("COMMIT");
    return result.rows;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally { client.release(); }
}

export async function setPlatformProviderStatus(provider: ProviderName, status: ProviderStatus, errorCode: string | null = null) {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.admin','true',true)");
    await client.query(
      "UPDATE platform_provider_configurations SET status=$2,last_verified_at=CASE WHEN $2='verified' THEN now() ELSE last_verified_at END,last_error_code=$3,updated_at=now() WHERE provider=$1",
      [provider, status, errorCode],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally { client.release(); }
}
