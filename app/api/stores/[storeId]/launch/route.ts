import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getRequestUser } from "@/lib/request-user";
import { evaluateStoreLaunch } from "@/lib/store-launch";

export const runtime = "nodejs";
type Context = { params: Promise<{ storeId: string }> };

export async function POST(_request: Request, context: Context) {
  const user = await getRequestUser();
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  const { storeId } = await context.params;
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.user_id', $1, true)", [user.id]);
    const owner = await client.query("SELECT 1 FROM store_memberships WHERE store_id=$1 AND user_id=$2 AND role='owner'", [storeId, user.id]);
    if (!owner.rowCount) { await client.query("ROLLBACK"); return NextResponse.json({ error: "Store owner access required" }, { status: 403 }); }
    const result = await client.query(`SELECT s.status, s.contact_phone, o.business_category, o.business_description,
      (SELECT count(*)::int FROM products p WHERE p.store_id=s.id AND p.status='active') AS active_product_count
      FROM stores s JOIN store_onboarding o ON o.store_id=s.id WHERE s.id=$1 FOR UPDATE OF s, o`, [storeId]);
    if (!result.rowCount) { await client.query("ROLLBACK"); return NextResponse.json({ error: "Store not found" }, { status: 404 }); }
    const store = result.rows[0];
    if (store.status === "active") { await client.query("COMMIT"); return NextResponse.json({ success: true, status: "active", message: "Your store is already live." }); }
    if (store.status === "suspended") { await client.query("ROLLBACK"); return NextResponse.json({ error: "This store is suspended. Contact platform support." }, { status: 409 }); }
    const decision = evaluateStoreLaunch({
      emailVerified: user.emailVerified === true,
      contactPhone: store.contact_phone,
      businessCategory: store.business_category,
      businessDescription: store.business_description,
      activeProductCount: Number(store.active_product_count),
    });
    if (decision.decision === "incomplete") {
      await client.query("UPDATE store_onboarding SET launch_status='incomplete', risk_flags=$1, updated_at=now() WHERE store_id=$2", [decision.riskFlags, storeId]);
      await client.query("COMMIT");
      return NextResponse.json({ status: "incomplete", missing: decision.missing, message: "Complete the remaining setup steps before submitting your store." }, { status: 409 });
    }
    if (decision.decision === "manual_review") {
      await client.query("UPDATE store_onboarding SET launch_status='pending_review', risk_flags=$1, submitted_at=COALESCE(submitted_at,now()), updated_at=now() WHERE store_id=$2", [decision.riskFlags, storeId]);
      await client.query("INSERT INTO audit_events (store_id, actor_user_id, action, resource_type, resource_id, metadata) VALUES ($1,$2,'store.launch_submitted','store',$1,$3::jsonb)", [storeId, user.id, JSON.stringify({ riskFlags: decision.riskFlags })]);
      await client.query("COMMIT");
      return NextResponse.json({ status: "pending_review", message: "Your setup is complete. The MobiWave team will review your store before launch." }, { status: 202 });
    }
    await client.query("UPDATE stores SET status='active', updated_at=now() WHERE id=$1", [storeId]);
    await client.query("UPDATE store_onboarding SET launch_status='auto_approved', risk_flags='{}', submitted_at=now(), auto_approved_at=now(), updated_at=now() WHERE store_id=$1", [storeId]);
    await client.query("INSERT INTO audit_events (store_id, actor_user_id, action, resource_type, resource_id, metadata) VALUES ($1,$2,'store.auto_launched','store',$1,$3::jsonb)", [storeId, user.id, JSON.stringify({ source: "launch_validator" })]);
    await client.query("COMMIT");
    return NextResponse.json({ success: true, status: "active", message: "Your store is live." });
  } catch {
    await client.query("ROLLBACK");
    return NextResponse.json({ error: "Could not submit store for launch" }, { status: 500 });
  } finally { client.release(); }
}