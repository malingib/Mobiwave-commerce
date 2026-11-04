import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getRequestUser } from "@/lib/request-user";

export const runtime = "nodejs";

export async function GET(_request: Request, context: { params: Promise<{ storeId: string }> }) {
  const user = await getRequestUser();
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  const { storeId } = await context.params;
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.user_id', $1, true)", [user.id]);
    await client.query("SELECT set_config('app.subscription_payment', 'true', true)");
    const member = await client.query(
      "SELECT role FROM store_memberships WHERE store_id=$1 AND user_id=$2 AND role IN ('owner','manager')",
      [storeId, user.id],
    );
    if (!member.rowCount) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "Store owner or manager access required" }, { status: 403 });
    }
    const result = await client.query(
      "SELECT s.id, s.name, s.slug, sub.plan_code, sub.status AS subscription_status, sub.current_period_start, sub.current_period_end FROM stores s JOIN subscriptions sub ON sub.store_id=s.id WHERE s.id=$1 LIMIT 1",
      [storeId],
    );
    if (!result.rowCount) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "Store billing record not found" }, { status: 404 });
    }
    const plans = await client.query(
      "SELECT code, name, description, amount_minor, currency, billing_interval, is_active, limits, features FROM commerce_plans WHERE is_active=true ORDER BY CASE code WHEN 'free' THEN 0 WHEN 'growth' THEN 1 WHEN 'pro' THEN 2 ELSE 3 END",
    );
    const mpesa = await client.query(
      "SELECT enabled FROM mpesa_configurations WHERE scope_type='platform' AND store_id IS NULL LIMIT 1",
    );
    const latestPayment = await client.query(
      "SELECT id, plan_code, amount_minor, currency, status, created_at FROM subscription_payment_attempts WHERE store_id=$1 ORDER BY created_at DESC LIMIT 1",
      [storeId],
    );
    await client.query("COMMIT");
    return NextResponse.json({
      billing: result.rows[0],
      plans: plans.rows,
      platformPaymentsEnabled: Boolean(mpesa.rows[0]?.enabled),
      latestPayment: latestPayment.rows[0] || null,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    await client.query("ROLLBACK");
    return NextResponse.json({ error: "Could not load billing details" }, { status: 500 });
  } finally { client.release(); }
}
