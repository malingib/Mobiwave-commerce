import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { normalizeStoreSlug } from "@/lib/tenant";
import { clientAddress, consumeRateLimit, rateLimitKey } from "@/lib/rate-limit";

export const runtime = "nodejs";
type CartLine = { productId: string; quantity: number };

export async function POST(request: Request, context: { params: Promise<{ slug: string }> }) {
  const { slug: rawSlug } = await context.params;
  const normalized = normalizeStoreSlug(rawSlug);
  if (!normalized.ok || normalized.slug !== rawSlug) return NextResponse.json({ error: "Store not found" }, { status: 404 });

  const idempotencyKey = request.headers.get("idempotency-key")?.trim();
  if (!idempotencyKey || idempotencyKey.length < 16 || idempotencyKey.length > 128 || !/^[A-Za-z0-9._:-]+$/.test(idempotencyKey)) {
    return NextResponse.json({ error: "A valid Idempotency-Key header (16–128 characters) is required." }, { status: 400 });
  }

  let body: { customerName?: unknown; customerEmail?: unknown; customerPhone?: unknown; address?: unknown; note?: unknown; paymentMethod?: unknown; items?: unknown };
  try {
    const length = Number(request.headers.get("content-length") || 0);
    if (length > 32_000) return NextResponse.json({ error: "Checkout request is too large." }, { status: 413 });
    body = await request.json();
  } catch { return NextResponse.json({ error: "Invalid checkout details" }, { status: 400 }); }

  const customerName = typeof body.customerName === "string" ? body.customerName.trim() : "";
  const customerPhone = typeof body.customerPhone === "string" ? body.customerPhone.trim() : "";
  const customerEmail = typeof body.customerEmail === "string" ? body.customerEmail.trim().toLowerCase() : null;
  const address = typeof body.address === "string" ? body.address.trim() : "";
  const note = typeof body.note === "string" ? body.note.trim().slice(0, 1000) : null;
  if (body.paymentMethod !== undefined && body.paymentMethod !== "manual" && body.paymentMethod !== "cash_on_delivery") {
    return NextResponse.json({ error: "Unsupported payment method." }, { status: 400 });
  }
  const paymentMethod = body.paymentMethod === "manual" ? "manual" : "cash_on_delivery";
  const items = Array.isArray(body.items) ? body.items as CartLine[] : [];
  if (customerName.length < 2 || customerName.length > 160 || customerPhone.length < 7 || customerPhone.length > 40 || address.length < 5 || address.length > 1000 || items.length < 1 || items.length > 50) {
    return NextResponse.json({ error: "Enter your name, phone, delivery address and at least one item." }, { status: 400 });
  }
  const quantities = new Map<string, number>();
  for (const item of items) {
    if (!item || typeof item.productId !== "string" || !/^[0-9a-f-]{36}$/i.test(item.productId) || !Number.isSafeInteger(item.quantity) || item.quantity < 1 || item.quantity > 100) {
      return NextResponse.json({ error: "One or more cart items are invalid." }, { status: 400 });
    }
    quantities.set(item.productId, (quantities.get(item.productId) || 0) + item.quantity);
  }
  if ([...quantities.values()].some(quantity => quantity > 100)) return NextResponse.json({ error: "Maximum quantity per product is 100." }, { status: 400 });

  const requestFingerprint = createHash("sha256").update(JSON.stringify({
    customerName, customerPhone, customerEmail, address, note, paymentMethod,
    items: [...quantities.entries()].sort(([a], [b]) => a.localeCompare(b)),
  })).digest("hex");

  const rate = await consumeRateLimit(rateLimitKey("checkout:" + normalized.slug, clientAddress(request)), 8, 600).catch(() => null);
  if (!rate) return NextResponse.json({ error: "Checkout is temporarily unavailable. Please try again shortly." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  if (!rate.allowed) return NextResponse.json({ error: "Too many checkout attempts. Please wait before trying again." }, {
    status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds), "Cache-Control": "no-store" },
  });

  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.checkout', 'true', true)");
    const storeResult = await client.query("SELECT id, currency FROM stores WHERE slug=$1 AND status='active' LIMIT 1", [normalized.slug]);
    if (!storeResult.rowCount) { await client.query("ROLLBACK"); return NextResponse.json({ error: "Store not found" }, { status: 404 }); }
    const store = storeResult.rows[0];

    const existing = await client.query(
      "SELECT id, order_number, total_minor, currency, status, created_at, idempotency_hash FROM orders WHERE store_id=$1 AND idempotency_key=$2 LIMIT 1",
      [store.id, idempotencyKey],
    );
    if (existing.rowCount) {
      const order = existing.rows[0];
      if (order.idempotency_hash !== requestFingerprint) {
        await client.query("ROLLBACK");
        return NextResponse.json({ error: "This Idempotency-Key was already used for different checkout details." }, { status: 409 });
      }
      await client.query("COMMIT");
      return NextResponse.json({ order: { id: order.id, orderNumber: order.order_number, totalMinor: Number(order.total_minor), currency: order.currency, status: order.status, createdAt: order.created_at }, idempotentReplay: true }, { status: 200 });
    }

    const productIds = [...quantities.keys()];
    const productResult = await client.query(
      "SELECT id, name, sku, price_minor, currency, stock_quantity FROM products WHERE store_id=$1 AND status='active' AND id = ANY($2::uuid[]) FOR UPDATE",
      [store.id, productIds],
    );
    if (productResult.rows.length !== productIds.length) { await client.query("ROLLBACK"); return NextResponse.json({ error: "A product is no longer available. Refresh the store and try again." }, { status: 409 }); }
    const products = new Map<string, { id: string; name: string; sku: string | null; price_minor: string | number; currency: string; stock_quantity: number | null }>(
      productResult.rows.map((product: { id: string; name: string; sku: string | null; price_minor: string | number; currency: string; stock_quantity: number | null }) => [product.id, product]),
    );
    let subtotal = 0;
    for (const [id, quantity] of quantities) {
      const product = products.get(id)!;
      if (product.stock_quantity !== null && product.stock_quantity < quantity) {
        await client.query("ROLLBACK");
        return NextResponse.json({ error: product.name + " does not have enough stock available." }, { status: 409 });
      }
      const line = Number(product.price_minor) * quantity;
      if (!Number.isSafeInteger(line) || !Number.isSafeInteger(subtotal + line)) {
        await client.query("ROLLBACK");
        return NextResponse.json({ error: "Cart total is too large." }, { status: 400 });
      }
      subtotal += line;
    }

    const orderResult = await client.query(
      "INSERT INTO orders (store_id, customer_name, customer_email, customer_phone, delivery_address, status, payment_status, payment_method, currency, subtotal_minor, delivery_fee_minor, total_minor, customer_note, idempotency_key, idempotency_hash) VALUES ($1,$2,$3,$4,$5::jsonb,'pending','unpaid',$6,$7,$8,0,$8,$9,$10,$11) RETURNING id, order_number, total_minor, currency, status, created_at",
      [store.id, customerName, customerEmail || null, customerPhone, JSON.stringify({ address }), paymentMethod, store.currency || "KES", subtotal, note, idempotencyKey, requestFingerprint],
    );
    const order = orderResult.rows[0];
    for (const [id, quantity] of quantities) {
      const product = products.get(id)!;
      const unitPrice = Number(product.price_minor);
      await client.query(
        "INSERT INTO order_items (store_id, order_id, product_id, product_name, sku, quantity, unit_price_minor, line_total_minor) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
        [store.id, order.id, product.id, product.name, product.sku, quantity, unitPrice, unitPrice * quantity],
      );
      if (product.stock_quantity !== null) {
        const updated = await client.query("UPDATE products SET stock_quantity=stock_quantity-$1, updated_at=now() WHERE id=$2 AND store_id=$3 AND stock_quantity >= $1", [quantity, id, store.id]);
        if (updated.rowCount !== 1) throw new Error("Stock changed during checkout");
      }
    }
    await client.query("COMMIT");
    return NextResponse.json({ order: { id: order.id, orderNumber: order.order_number, totalMinor: Number(order.total_minor), currency: order.currency, status: order.status, createdAt: order.created_at } }, { status: 201 });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    const pgError = error as { code?: string };
    if (pgError.code === "23505") return NextResponse.json({ error: "This checkout request was already received. Retry with the same Idempotency-Key to retrieve the order." }, { status: 409 });
    return NextResponse.json({ error: "We could not place your order. Please try again." }, { status: 500 });
  } finally { client.release(); }
}
