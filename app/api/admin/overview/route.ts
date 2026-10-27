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
    await client.query("SELECT set_config('app.admin', 'true', true)");
    const stores = await client.query(
      `SELECT s.id, s.name, s.slug, s.status, s.currency, s.created_at,
        COALESCE(sub.plan_code,'free') AS plan_code,
        COALESCE(sub.status,'active') AS subscription_status,
        COUNT(DISTINCT o.id)::int AS order_count,
        COALESCE(SUM(CASE WHEN o.payment_status='paid' THEN o.total_minor ELSE 0 END),0)::bigint AS paid_volume_minor,
        COUNT(DISTINCT m.user_id)::int AS member_count
      FROM stores s
      LEFT JOIN subscriptions sub ON sub.store_id=s.id
      LEFT JOIN orders o ON o.store_id=s.id
      LEFT JOIN store_memberships m ON m.store_id=s.id
      GROUP BY s.id, sub.plan_code, sub.status
      ORDER BY s.created_at DESC
      LIMIT 500`
    );
    const totals = await client.query(
      `SELECT COUNT(*)::int AS store_count,
        COUNT(*) FILTER (WHERE status='active')::int AS active_stores,
        COUNT(*) FILTER (WHERE status='suspended')::int AS suspended_stores
      FROM stores`
    );
    await client.query("COMMIT");
    return NextResponse.json({ stores: stores.rows, totals: totals.rows[0] }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    await client.query("ROLLBACK");
    return NextResponse.json({ error: "Could not load platform overview" }, { status: 500 });
  } finally { client.release(); }
}
