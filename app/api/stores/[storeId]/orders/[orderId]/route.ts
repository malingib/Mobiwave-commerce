import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getRequestUser } from "@/lib/request-user";

export const runtime = "nodejs";
const transitions: Record<string, string[]> = {
  pending: ["confirmed", "cancelled"],
  confirmed: ["processing", "cancelled"],
  processing: ["ready", "shipped", "cancelled"],
  ready: ["shipped", "completed", "cancelled"],
  shipped: ["completed"],
  completed: [],
  cancelled: [],
};

export async function PATCH(request: Request, context: { params: Promise<{ storeId: string; orderId: string }> }) {
  const user = await getRequestUser();
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  const { storeId, orderId } = await context.params;
  let body: { status?: unknown };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid request" }, { status: 400 }); }
  const status = body.status;
  if (typeof status !== "string" || !Object.prototype.hasOwnProperty.call(transitions, status)) return NextResponse.json({ error: "Invalid order status" }, { status: 400 });
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.user_id', $1, true)", [user.id]);
    const current = await client.query(
      "SELECT id, status, payment_status, payment_method FROM orders WHERE id=$1 AND store_id=$2 FOR UPDATE",
      [orderId, storeId],
    );
    if (!current.rowCount) { await client.query("ROLLBACK"); return NextResponse.json({ error: "Order not found or access denied" }, { status: 404 }); }
    const order = current.rows[0];
    if (!transitions[order.status]?.includes(status)) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: `Order cannot move from ${order.status} to ${status}` }, { status: 409 });
    }
    if (status === "completed" && order.payment_status !== "paid" && order.payment_method !== "cash_on_delivery") {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "Payment must be confirmed before this order can be completed." }, { status: 409 });
    }
    // Mark cash-on-delivery paid only when the merchant explicitly completes fulfilment,
    // which represents confirmation that cash was collected.
    const updated = await client.query(
      "UPDATE orders SET status=$1, payment_status=CASE WHEN $1='completed' AND payment_method='cash_on_delivery' THEN 'paid'::payment_status ELSE payment_status END, updated_at=now() WHERE id=$2 AND store_id=$3 RETURNING id, order_number, status, payment_status, updated_at",
      [status, orderId, storeId],
    );
    await client.query(
      "INSERT INTO audit_events (store_id, actor_user_id, action, resource_type, resource_id, metadata) VALUES ($1,$2,$3,'order',$4,$5::jsonb)",
      [storeId, user.id, `order.${status}`, orderId, JSON.stringify({ previousStatus: order.status, previousPaymentStatus: order.payment_status, paymentStatus: updated.rows[0].payment_status })],
    );
    await client.query("COMMIT");
    return NextResponse.json({ order: updated.rows[0] });
  } catch {
    await client.query("ROLLBACK").catch(() => undefined);
    return NextResponse.json({ error: "Could not update order status" }, { status: 500 });
  } finally { client.release(); }
}
