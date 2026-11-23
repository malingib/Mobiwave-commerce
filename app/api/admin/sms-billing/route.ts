import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSuperAdmin } from "@/lib/admin";

export const runtime = "nodejs";

export async function GET() {
  const user = await getSuperAdmin();
  if (!user) return NextResponse.json({ error: "Superadmin access required" }, { status: 403 });
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.admin','true',true)");
    const result = await client.query(
      `SELECT s.id AS store_id,s.name,s.slug,
        c.included_segments_per_month,c.unit_rate_minor,c.currency,c.enabled,c.updated_at,
        w.available_balance_minor,w.status AS wallet_status,
        COALESCE(u.monthly_segments,0)::bigint AS monthly_segments,
        COALESCE(u.monthly_amount_minor,0)::bigint AS monthly_amount_minor
       FROM stores s
       LEFT JOIN store_sms_billing_config c ON c.store_id=s.id
       LEFT JOIN store_wallet_accounts w ON w.store_id=s.id
       LEFT JOIN (
         SELECT store_id,SUM(total_segments)::bigint AS monthly_segments,SUM(amount_minor)::bigint AS monthly_amount_minor
         FROM store_sms_usage
         WHERE period_start=date_trunc('month',now() AT TIME ZONE 'UTC')::date
           AND status IN ('reserved','committed')
         GROUP BY store_id
       ) u ON u.store_id=s.id
       ORDER BY s.created_at DESC`,
    );
    await client.query("COMMIT");
    return NextResponse.json({ stores: result.rows }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    await client.query("ROLLBACK").catch(()=>undefined);
    return NextResponse.json({ error: "Could not load SMS billing settings" }, { status: 500 });
  } finally { client.release(); }
}

export async function PUT(request: Request) {
  const user = await getSuperAdmin();
  if (!user) return NextResponse.json({ error: "Superadmin access required" }, { status: 403 });
  let body: { storeId?: unknown; includedSegmentsPerMonth?: unknown; unitRateMinor?: unknown; currency?: unknown; enabled?: unknown };
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }); }
  if (typeof body.storeId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.storeId)) {
    return NextResponse.json({ error: "A valid store ID is required" }, { status: 400 });
  }
  const included = Number(body.includedSegmentsPerMonth);
  const rate = Number(body.unitRateMinor);
  const currency = typeof body.currency === "string" ? body.currency.toUpperCase() : "";
  if (!Number.isSafeInteger(included) || included < 0 || !Number.isSafeInteger(rate) || rate < 0
    || !/^[A-Z]{3}$/.test(currency) || typeof body.enabled !== "boolean") {
    return NextResponse.json({ error: "Provide a non-negative monthly allowance, non-negative rate in minor units, ISO currency and enabled state." }, { status: 400 });
  }
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.admin','true',true)");
    const store = await client.query("SELECT id FROM stores WHERE id=$1 FOR UPDATE",[body.storeId]);
    if (!store.rowCount) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "Store not found" }, { status: 404 });
    }
    if (body.enabled && rate > 0) {
      const wallet = await client.query("SELECT currency FROM store_wallet_accounts WHERE store_id=$1",[body.storeId]);
      if (wallet.rowCount && String(wallet.rows[0].currency).trim() !== currency) {
        await client.query("ROLLBACK");
        return NextResponse.json({ error: "SMS billing currency must match the store wallet currency." }, { status: 409 });
      }
    }
    const saved = await client.query(
      `INSERT INTO store_sms_billing_config
        (store_id,included_segments_per_month,unit_rate_minor,currency,enabled,updated_by,updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,now())
       ON CONFLICT (store_id) DO UPDATE SET
         included_segments_per_month=EXCLUDED.included_segments_per_month,
         unit_rate_minor=EXCLUDED.unit_rate_minor,currency=EXCLUDED.currency,
         enabled=EXCLUDED.enabled,updated_by=EXCLUDED.updated_by,updated_at=now()
       RETURNING store_id,included_segments_per_month,unit_rate_minor,currency,enabled,updated_at`,
      [body.storeId,included,rate,currency,body.enabled,user.id],
    );
    await client.query(
      "INSERT INTO audit_events (actor_user_id,action,resource_type,resource_id,metadata) VALUES ($1,'sms_billing.updated','store_sms_billing_config',$2,$3::jsonb)",
      [user.id,body.storeId,JSON.stringify(saved.rows[0])],
    );
    await client.query("COMMIT");
    return NextResponse.json({ config: saved.rows[0] }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    await client.query("ROLLBACK").catch(()=>undefined);
    return NextResponse.json({ error: "Could not save SMS billing settings" }, { status: 500 });
  } finally { client.release(); }
}
