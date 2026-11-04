import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSuperAdmin } from "@/lib/admin";

export const runtime = "nodejs";
const validCodes = new Set(["free", "growth", "pro", "business"]);

export async function GET() {
  const user = await getSuperAdmin();
  if (!user) return NextResponse.json({ error: "Superadmin access required" }, { status: 403 });
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.admin', 'true', true)");
    const result = await client.query(
      "SELECT code, name, description, amount_minor, currency, billing_interval, is_active, limits, features, updated_at FROM commerce_plans ORDER BY CASE code WHEN 'free' THEN 0 WHEN 'growth' THEN 1 WHEN 'pro' THEN 2 ELSE 3 END",
    );
    await client.query("COMMIT");
    return NextResponse.json({ plans: result.rows }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    await client.query("ROLLBACK");
    return NextResponse.json({ error: "Could not load plan catalogue" }, { status: 500 });
  } finally { client.release(); }
}

export async function PUT(request: Request) {
  const user = await getSuperAdmin();
  if (!user) return NextResponse.json({ error: "Superadmin access required" }, { status: 403 });
  let body: { code?: unknown; amountMinor?: unknown; isActive?: unknown; limits?: unknown; billingInterval?: unknown };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid request body" }, { status: 400 }); }
  if (typeof body.code !== "string" || !validCodes.has(body.code)) {
    return NextResponse.json({ error: "Invalid plan code" }, { status: 400 });
  }
  const amountMinor = body.amountMinor === null ? null : Number(body.amountMinor);
  if (amountMinor !== null && (!Number.isSafeInteger(amountMinor) || amountMinor < 0)) {
    return NextResponse.json({ error: "Plan price must be a non-negative integer in minor currency units." }, { status: 400 });
  }
  if (body.code === "free" && amountMinor !== 0) {
    return NextResponse.json({ error: "The Free plan must remain zero-priced." }, { status: 400 });
  }
  if (typeof body.isActive !== "boolean" || (body.billingInterval !== "monthly" && body.billingInterval !== "yearly")) {
    return NextResponse.json({ error: "Provide a valid active state and billing interval." }, { status: 400 });
  }
  if (!body.limits || typeof body.limits !== "object" || Array.isArray(body.limits)) {
    return NextResponse.json({ error: "Plan limits must be an object." }, { status: 400 });
  }
  const limitsInput = body.limits as Record<string, unknown>;
  const limits: Record<string, number> = {};
  for (const key of ["maxProducts", "maxDomains", "maxMembers"]) {
    const value = limitsInput[key];
    if (value === null || value === undefined || value === "") continue;
    const numeric = Number(value);
    if (!Number.isSafeInteger(numeric) || numeric < 0) {
      return NextResponse.json({ error: `${key} must be a non-negative integer or blank for unlimited.` }, { status: 400 });
    }
    limits[key] = numeric;
  }

  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.admin', 'true', true)");
    const result = await client.query(
      "UPDATE commerce_plans SET amount_minor=$1, is_active=$2, billing_interval=$3, limits=$4::jsonb, updated_by=$5, updated_at=now() WHERE code=$6 RETURNING code, amount_minor, currency, billing_interval, is_active, limits",
      [amountMinor, body.isActive, body.billingInterval, JSON.stringify(limits), user.id, body.code],
    );
    if (!result.rowCount) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "Plan not found" }, { status: 404 });
    }
    await client.query(
      "INSERT INTO audit_events (actor_user_id, action, resource_type, resource_id, metadata) VALUES ($1,'plan.updated','commerce_plan',$2,$3::jsonb)",
      [user.id, body.code, JSON.stringify(result.rows[0])],
    );
    await client.query("COMMIT");
    return NextResponse.json({ plan: result.rows[0] });
  } catch {
    await client.query("ROLLBACK");
    return NextResponse.json({ error: "Could not update plan" }, { status: 500 });
  } finally { client.release(); }
}
