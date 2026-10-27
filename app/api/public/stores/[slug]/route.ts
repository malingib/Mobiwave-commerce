import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { normalizeStoreSlug } from "@/lib/tenant";

export const runtime = "nodejs";

export async function GET(_request: Request, context: { params: Promise<{ slug: string }> }) {
  const { slug: rawSlug } = await context.params;
  const normalized = normalizeStoreSlug(rawSlug);
  if (!normalized.ok || normalized.slug !== rawSlug) return NextResponse.json({ error: "Store not found" }, { status: 404 });
  const client = await db.connect();
  try {
    const storeResult = await client.query(
      "SELECT id, name, slug, currency FROM stores WHERE slug = $1 AND status = 'active' LIMIT 1",
      [normalized.slug]
    );
    if (!storeResult.rowCount) return NextResponse.json({ error: "Store not found" }, { status: 404 });
    const store = storeResult.rows[0];
    const productsResult = await client.query(
      "SELECT id, name, slug, description, price_minor, currency, stock_quantity, image_url FROM products WHERE store_id = $1 AND status = 'active' ORDER BY created_at DESC",
      [store.id]
    );
    return NextResponse.json({ store, products: productsResult.rows }, { headers: { "Cache-Control": "public, s-maxage=30, stale-while-revalidate=120" } });
  } catch {
    return NextResponse.json({ error: "Storefront is temporarily unavailable" }, { status: 500 });
  } finally { client.release(); }
}
