import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSuperAdmin } from "@/lib/admin";
import { encryptCredential, type MpesaConfigInput } from "@/lib/mpesa-config";

export const runtime = "nodejs";

export async function GET() {
  const user = await getSuperAdmin();
  if (!user) return NextResponse.json({ error: "Superadmin access required" }, { status: 403 });
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.admin', 'true', true)");
    const result = await client.query(
      "SELECT shortcode, environment, transaction_type, enabled, (consumer_key_ciphertext <> '' AND consumer_secret_ciphertext <> '' AND passkey_ciphertext <> '') AS credentials_saved, updated_at FROM mpesa_configurations WHERE scope_type='platform' AND store_id IS NULL LIMIT 1"
    );
    await client.query("COMMIT");
    return NextResponse.json({ configuration: result.rows[0] || null }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    await client.query("ROLLBACK");
    return NextResponse.json({ error: "Could not load M-Pesa configuration" }, { status: 500 });
  } finally { client.release(); }
}

export async function PUT(request: Request) {
  const user = await getSuperAdmin();
  if (!user) return NextResponse.json({ error: "Superadmin access required" }, { status: 403 });
  let body: Partial<MpesaConfigInput>;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }); }
  const consumerKey = typeof body.consumerKey === "string" ? body.consumerKey.trim() : "";
  const consumerSecret = typeof body.consumerSecret === "string" ? body.consumerSecret.trim() : "";
  const shortcode = typeof body.shortcode === "string" ? body.shortcode.trim() : "";
  const passkey = typeof body.passkey === "string" ? body.passkey.trim() : "";
  const environment = body.environment;
  const transactionType = body.transactionType;
  if (!consumerKey || !consumerSecret || !/^[0-9]{5,7}$/.test(shortcode) || !passkey ||
      (environment !== "sandbox" && environment !== "production") ||
      (transactionType !== "CustomerPayBillOnline" && transactionType !== "CustomerBuyGoodsOnline") ||
      typeof body.enabled !== "boolean") {
    return NextResponse.json({ error: "Provide valid Daraja credentials, shortcode, environment and transaction type." }, { status: 400 });
  }
  let keyCipher: string, secretCipher: string, passkeyCipher: string;
  try {
    keyCipher = encryptCredential(consumerKey);
    secretCipher = encryptCredential(consumerSecret);
    passkeyCipher = encryptCredential(passkey);
  } catch {
    return NextResponse.json({ error: "Server credential encryption is not configured. Set MPESA_CREDENTIALS_ENCRYPTION_KEY to a base64-encoded 32-byte key." }, { status: 503 });
  }
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.admin', 'true', true)");
    await client.query(
      `INSERT INTO mpesa_configurations (scope_type, store_id, consumer_key_ciphertext, consumer_secret_ciphertext, shortcode, passkey_ciphertext, environment, transaction_type, enabled, updated_by)
       VALUES ('platform', NULL, $1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (scope_type) WHERE scope_type='platform' DO UPDATE SET consumer_key_ciphertext=EXCLUDED.consumer_key_ciphertext, consumer_secret_ciphertext=EXCLUDED.consumer_secret_ciphertext, shortcode=EXCLUDED.shortcode, passkey_ciphertext=EXCLUDED.passkey_ciphertext, environment=EXCLUDED.environment, transaction_type=EXCLUDED.transaction_type, enabled=EXCLUDED.enabled, updated_by=EXCLUDED.updated_by, updated_at=now()`,
      [keyCipher, secretCipher, shortcode, passkeyCipher, environment, transactionType, body.enabled, user.id]
    );
    await client.query("INSERT INTO audit_events (actor_user_id, action, resource_type, metadata) VALUES ($1, 'mpesa.platform_config_updated', 'mpesa_configuration', $2::jsonb)", [user.id, JSON.stringify({ environment, transactionType, enabled: body.enabled })]);
    await client.query("COMMIT");
    return NextResponse.json({ ok: true });
  } catch {
    await client.query("ROLLBACK");
    return NextResponse.json({ error: "Could not save platform M-Pesa configuration" }, { status: 500 });
  } finally { client.release(); }
}
