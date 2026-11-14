import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getRequestUser } from "@/lib/request-user";
import { encryptCredential, type MpesaConfigInput } from "@/lib/mpesa-config";

export const runtime = "nodejs";
type Context = { params: Promise<{ storeId: string }> };

export async function GET(_request: Request, context: Context) {
  const user = await getRequestUser();
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  const { storeId } = await context.params;
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.user_id', $1, true)", [user.id]);
    const result = await client.query(
      "SELECT c.shortcode, c.environment, c.transaction_type, c.enabled, true AS credentials_saved, c.updated_at FROM mpesa_configurations c WHERE c.scope_type='store' AND c.store_id=$1 AND EXISTS (SELECT 1 FROM store_memberships m WHERE m.store_id=c.store_id AND m.user_id=$2 AND m.role IN ('owner','manager')) LIMIT 1",
      [storeId, user.id]
    );
    const membership = await client.query("SELECT role FROM store_memberships WHERE store_id=$1 AND user_id=$2 AND role IN ('owner','manager')", [storeId, user.id]);
    await client.query("COMMIT");
    if (!membership.rowCount) return NextResponse.json({ error: "Store owner or manager access required" }, { status: 403 });
    return NextResponse.json({ configuration: result.rows[0] || null }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    await client.query("ROLLBACK");
    return NextResponse.json({ error: "Could not load M-Pesa configuration" }, { status: 500 });
  } finally { client.release(); }
}

export async function PUT(request: Request, context: Context) {
  const user = await getRequestUser();
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  const { storeId } = await context.params;
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
    await client.query("SELECT set_config('app.user_id', $1, true)", [user.id]);
    const membership = await client.query("SELECT role FROM store_memberships WHERE store_id=$1 AND user_id=$2 AND role IN ('owner','manager')", [storeId, user.id]);
    if (!membership.rowCount) { await client.query("ROLLBACK"); return NextResponse.json({ error: "Store owner or manager access required" }, { status: 403 }); }
    await client.query(
      `INSERT INTO mpesa_configurations (scope_type, store_id, consumer_key_ciphertext, consumer_secret_ciphertext, shortcode, passkey_ciphertext, environment, transaction_type, enabled, updated_by)
       VALUES ('store', $1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (scope_type, store_id) DO UPDATE SET consumer_key_ciphertext=EXCLUDED.consumer_key_ciphertext, consumer_secret_ciphertext=EXCLUDED.consumer_secret_ciphertext, shortcode=EXCLUDED.shortcode, passkey_ciphertext=EXCLUDED.passkey_ciphertext, environment=EXCLUDED.environment, transaction_type=EXCLUDED.transaction_type, enabled=EXCLUDED.enabled, updated_by=EXCLUDED.updated_by, updated_at=now()`,
      [storeId, keyCipher, secretCipher, shortcode, passkeyCipher, environment, transactionType, body.enabled, user.id]
    );
    await client.query("INSERT INTO audit_events (store_id, actor_user_id, action, resource_type, metadata) VALUES ($1, $2, 'mpesa.store_config_updated', 'mpesa_configuration', $3::jsonb)", [storeId, user.id, JSON.stringify({ environment, transactionType, enabled: body.enabled })]);
    await client.query("COMMIT");
    return NextResponse.json({ ok: true });
  } catch {
    await client.query("ROLLBACK");
    return NextResponse.json({ error: "Could not save merchant M-Pesa configuration" }, { status: 500 });
  } finally { client.release(); }
}
