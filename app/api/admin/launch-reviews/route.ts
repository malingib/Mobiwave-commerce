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
    const result = await client.query(`SELECT s.id AS store_id, s.name, s.slug, s.contact_email, s.contact_phone, s.created_at,
      o.business_category, o.business_description, o.website_url, o.risk_flags, o.submitted_at, o.launch_status, o.review_note,
      COALESCE(p.product_count,0)::int AS active_product_count
      FROM store_onboarding o JOIN stores s ON s.id=o.store_id
      LEFT JOIN LATERAL (SELECT count(*)::int AS product_count FROM products WHERE store_id=s.id AND status='active') p ON true
      WHERE o.launch_status='pending_review' ORDER BY o.submitted_at ASC LIMIT 200`);
    await client.query("COMMIT");
    return NextResponse.json({ reviews: result.rows }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    await client.query("ROLLBACK");
    return NextResponse.json({ error: "Could not load launch review queue" }, { status: 500 });
  } finally { client.release(); }
}