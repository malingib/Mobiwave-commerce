import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getRequestUser } from "@/lib/request-user";
import { normalizeStoreSlug } from "@/lib/tenant";

export const runtime = "nodejs";

export async function GET() {
  const user = await getRequestUser();
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });

  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.user_id', $1, true)", [user.id]);
    const result = await client.query(
      "SELECT s.id, s.name, s.slug, s.status, s.currency, s.created_at FROM stores s ORDER BY s.created_at DESC"
    );
    await client.query("COMMIT");
    return NextResponse.json({ stores: result.rows });
  } catch {
    await client.query("ROLLBACK");
    return NextResponse.json({ error: "Could not load stores" }, { status: 500 });
  } finally {
    client.release();
  }
}

export async function POST(request: Request) {
  const user = await getRequestUser();
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });

  let body: { name?: unknown; slug?: unknown; phone?: unknown };
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const rawSlug = typeof body.slug === "string" && body.slug.trim() ? body.slug : name;
  const slugResult = normalizeStoreSlug(rawSlug);
  if (name.length < 2 || name.length > 100) {
    return NextResponse.json({ error: "Store name must be between 2 and 100 characters" }, { status: 400 });
  }
  if (!slugResult.ok) {
    return NextResponse.json({ error: slugResult.reason === "reserved" ? "That store address is reserved" : "Enter a valid store address" }, { status: 400 });
  }
  const phone = typeof body.phone === "string" ? body.phone.trim().slice(0, 40) : null;

  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.user_id', $1, true)", [user.id]);
    await client.query("SELECT set_config('app.provisioning', 'true', true)");
    const inserted = await client.query(
      "INSERT INTO stores (name, slug, status, contact_email, contact_phone) VALUES ($1, $2, 'active', $3, $4) RETURNING id, name, slug, status, currency, created_at",
      [name, slugResult.slug, user.email, phone]
    );
    const store = inserted.rows[0];
    await client.query(
      "INSERT INTO store_memberships (store_id, user_id, role) VALUES ($1, $2, 'owner')",
      [store.id, user.id]
    );
    await client.query("INSERT INTO subscriptions (store_id, plan_code, status) VALUES ($1, 'free', 'active')", [store.id]);
    await client.query(
      "INSERT INTO audit_events (store_id, actor_user_id, action, resource_type, resource_id) VALUES ($1, $2, 'store.created', 'store', $1)",
      [store.id, user.id]
    );
    await client.query("COMMIT");
    return NextResponse.json({ store }, { status: 201 });
  } catch (error) {
    await client.query("ROLLBACK");
    const pgError = error as { code?: string };
    if (pgError.code === "23505") return NextResponse.json({ error: "That store address is already taken" }, { status: 409 });
    return NextResponse.json({ error: "Could not create store. Please try again." }, { status: 500 });
  } finally {
    client.release();
  }
}
