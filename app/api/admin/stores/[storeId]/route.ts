import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSuperAdmin } from "@/lib/admin";

export const runtime = "nodejs";

export async function PATCH(request: Request, context: { params: Promise<{ storeId: string }> }) {
  const user = await getSuperAdmin();
  if (!user) return NextResponse.json({ error: "Superadmin access required" }, { status: 403 });
  const { storeId } = await context.params;
  let body: { status?: unknown; planCode?: unknown };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid request body" }, { status: 400 }); }
  const validStatuses = ["draft", "active", "suspended"];
  const validPlans = ["free", "growth", "pro", "business"];
  if ((body.status !== undefined && (typeof body.status !== "string" || !validStatuses.includes(body.status))) ||
      (body.planCode !== undefined && (typeof body.planCode !== "string" || !validPlans.includes(body.planCode))) ||
      (body.status === undefined && body.planCode === undefined)) {
    return NextResponse.json({ error: "Invalid store status or plan" }, { status: 400 });
  }
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.admin', 'true', true)");
    const store = await client.query("SELECT id, name, status FROM stores WHERE id=$1 FOR UPDATE", [storeId]);
    if (!store.rowCount) { await client.query("ROLLBACK"); return NextResponse.json({ error: "Store not found" }, { status: 404 }); }
    if (body.status !== undefined) {
      await client.query("UPDATE stores SET status=$1, updated_at=now() WHERE id=$2", [body.status, storeId]);
    }
    if (body.planCode !== undefined) {
      await client.query(
        `INSERT INTO subscriptions (store_id, plan_code, status) VALUES ($1,$2,'active')
         ON CONFLICT (store_id) DO UPDATE SET plan_code=EXCLUDED.plan_code, status='active', updated_at=now()`,
        [storeId, body.planCode]
      );
    }
    await client.query(
      "INSERT INTO audit_events (store_id, actor_user_id, action, resource_type, resource_id, metadata) VALUES ($1,$2,$3,'store',$1,$4::jsonb)",
      [storeId, user.id, body.status !== undefined ? `store.${body.status}` : `subscription.${body.planCode}`, JSON.stringify({ status: body.status, planCode: body.planCode })]
    );
    await client.query("COMMIT");
    return NextResponse.json({ success: true });
  } catch {
    await client.query("ROLLBACK");
    return NextResponse.json({ error: "Could not update store" }, { status: 500 });
  } finally { client.release(); }
}
