import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getRequestUser } from "@/lib/request-user";
import { STORE_BUSINESS_CATEGORIES } from "@/lib/store-launch";

export const runtime = "nodejs";
type Context = { params: Promise<{ storeId: string }> };

function normalizeWebsite(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" || !url.hostname || url.username || url.password || url.toString().length > 2048) return null;
    return url.toString();
  } catch { return null; }
}

export async function GET(_request: Request, context: Context) {
  const user = await getRequestUser();
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  const { storeId } = await context.params;
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.user_id', $1, true)", [user.id]);
    const member = await client.query("SELECT role FROM store_memberships WHERE store_id=$1 AND user_id=$2 AND role IN ('owner','manager')", [storeId, user.id]);
    if (!member.rowCount) { await client.query("ROLLBACK"); return NextResponse.json({ error: "Store owner or manager access required" }, { status: 403 }); }
    const result = await client.query(`SELECT s.name, s.slug, s.contact_email, s.contact_phone,
      o.business_category, o.business_description, o.website_url, o.launch_status, o.risk_flags,
      o.submitted_at, o.review_note,
      (SELECT count(*)::int FROM products p WHERE p.store_id=s.id AND p.status='active') AS active_product_count
      FROM stores s JOIN store_onboarding o ON o.store_id=s.id WHERE s.id=$1`, [storeId]);
    await client.query("COMMIT");
    if (!result.rowCount) return NextResponse.json({ error: "Store not found" }, { status: 404 });
    return NextResponse.json({ onboarding: result.rows[0], email_verified: user.emailVerified === true }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    await client.query("ROLLBACK");
    return NextResponse.json({ error: "Could not load store onboarding" }, { status: 500 });
  } finally { client.release(); }
}

export async function PATCH(request: Request, context: Context) {
  const user = await getRequestUser();
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  const { storeId } = await context.params;
  let body: { businessCategory?: unknown; businessDescription?: unknown; websiteUrl?: unknown; contactPhone?: unknown };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid request body" }, { status: 400 }); }
  const category = typeof body.businessCategory === "string" ? body.businessCategory : "";
  const description = typeof body.businessDescription === "string" ? body.businessDescription.trim() : "";
  const phone = typeof body.contactPhone === "string" ? body.contactPhone.trim() : "";
  const websiteUrl = body.websiteUrl === undefined || body.websiteUrl === null || body.websiteUrl === "" ? null : normalizeWebsite(body.websiteUrl);
  if (!STORE_BUSINESS_CATEGORIES.includes(category as typeof STORE_BUSINESS_CATEGORIES[number])) return NextResponse.json({ error: "Choose a valid business category" }, { status: 400 });
  if (description.length > 2000) return NextResponse.json({ error: "Business description must be 2,000 characters or fewer" }, { status: 400 });
  if (body.contactPhone !== undefined && (phone.length < 8 || phone.length > 40)) return NextResponse.json({ error: "Enter a valid business phone number" }, { status: 400 });
  if (body.websiteUrl && !websiteUrl) return NextResponse.json({ error: "Website must be a valid HTTPS URL" }, { status: 400 });

  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.user_id', $1, true)", [user.id]);
    const member = await client.query("SELECT 1 FROM store_memberships WHERE store_id=$1 AND user_id=$2 AND role='owner'", [storeId, user.id]);
    if (!member.rowCount) { await client.query("ROLLBACK"); return NextResponse.json({ error: "Only the store owner can update onboarding details" }, { status: 403 }); }
    const current = await client.query("SELECT status FROM stores WHERE id=$1 FOR UPDATE", [storeId]);
    if (!current.rowCount) { await client.query("ROLLBACK"); return NextResponse.json({ error: "Store not found" }, { status: 404 }); }
    if (current.rows[0].status !== "draft") { await client.query("ROLLBACK"); return NextResponse.json({ error: "Onboarding details are locked after launch. Contact support to make changes." }, { status: 409 }); }
    await client.query(`UPDATE store_onboarding SET business_category=$1, business_description=$2, website_url=$3,
      launch_status='incomplete', risk_flags='{}', submitted_at=NULL, updated_at=now() WHERE store_id=$4`,
      [category, description, websiteUrl, storeId]);
    if (body.contactPhone !== undefined) await client.query("UPDATE stores SET contact_phone=$1, updated_at=now() WHERE id=$2", [phone, storeId]);
    await client.query("INSERT INTO audit_events (store_id, actor_user_id, action, resource_type, resource_id) VALUES ($1,$2,'store.onboarding_updated','store',$1)", [storeId, user.id]);
    await client.query("COMMIT");
    return NextResponse.json({ success: true, message: "Business details saved." });
  } catch {
    await client.query("ROLLBACK");
    return NextResponse.json({ error: "Could not save onboarding details" }, { status: 500 });
  } finally { client.release(); }
}