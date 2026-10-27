import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getRequestUser } from "@/lib/request-user";
import { normalizeStoreSlug } from "@/lib/tenant";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ storeId: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const user = await getRequestUser();
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  const { storeId } = await context.params;
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.user_id', $1, true)", [user.id]);
    const result = await client.query(
      "SELECT id, name, slug, description, sku, price_minor, currency, stock_quantity, status, image_url, created_at FROM products WHERE store_id = $1 ORDER BY created_at DESC",
      [storeId]
    );
    await client.query("COMMIT");
    return NextResponse.json({ products: result.rows });
  } catch {
    await client.query("ROLLBACK");
    return NextResponse.json({ error: "Could not load products" }, { status: 500 });
  } finally { client.release(); }
}

export async function POST(request: Request, context: RouteContext) {
  const user = await getRequestUser();
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  const { storeId } = await context.params;
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const description = typeof body.description === "string" ? body.description.trim().slice(0, 5000) : "";
  const sku = typeof body.sku === "string" && body.sku.trim() ? body.sku.trim().slice(0, 100) : null;
  const price = Number(body.price);
  const stock = body.stock === "" || body.stock === null || body.stock === undefined ? null : Number(body.stock);
  const slugResult = normalizeStoreSlug(typeof body.slug === "string" && body.slug.trim() ? body.slug : name);
  if (name.length < 1 || name.length > 160 || !slugResult.ok || !Number.isSafeInteger(Math.round(price * 100)) || price < 0 || (stock !== null && (!Number.isSafeInteger(stock) || stock < 0))) {
    return NextResponse.json({ error: "Check the product name, address, price and stock quantity" }, { status: 400 });
  }

  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.user_id', $1, true)", [user.id]);
    const result = await client.query(
      "INSERT INTO products (store_id, name, slug, description, sku, price_minor, currency, stock_quantity, status) VALUES ($1, $2, $3, $4, $5, $6, 'KES', $7, 'draft') RETURNING id, name, slug, description, sku, price_minor, currency, stock_quantity, status, created_at",
      [storeId, name, slugResult.slug, description, sku, Math.round(price * 100), stock]
    );
    await client.query(
      "INSERT INTO audit_events (store_id, actor_user_id, action, resource_type, resource_id) VALUES ($1, $2, 'product.created', 'product', $3)",
      [storeId, user.id, result.rows[0].id]
    );
    await client.query("COMMIT");
    return NextResponse.json({ product: result.rows[0] }, { status: 201 });
  } catch (error) {
    await client.query("ROLLBACK");
    const pgError = error as { code?: string };
    if (pgError.code === "23505") return NextResponse.json({ error: "That product address or SKU already exists" }, { status: 409 });
    return NextResponse.json({ error: "Could not create product. Confirm you have access to this store." }, { status: 500 });
  } finally { client.release(); }
}
