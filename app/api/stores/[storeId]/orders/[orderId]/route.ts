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
    const current = await client.query("SELECT id, status FROM orders WHERE id=$1 AND store_id=$2 FOR UPDATE", [orderId, storeId]);
    if (!current.rowCount) { await client.query("ROLLBACK"); return NextResponse.json({ error: "Order not found or access denied" }, { status: 404 }); }
    if (!transitions[current.rows[0].status]?.includes(status)) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: `Order cannot move from ${current.rows[0].status} to ${status}` }, { status: 409 });
    }
    const updated = await client.query("UPDATE orders SET status=$1, updated_at=now() WHERE id=$2 AND store_id=$3 RETURNING id, order_number, status, payment_status, updated_at", [status, orderId, storeId]);
    await client.query("INSERT INTO audit_events (store_id, actor_user_id, action, resource_type, resource_id) VALUES ($1,$2,$3,'order',$4)", [storeId, user.id, `order.${status}`, orderId]);
    await client.query("COMMIT");
    return NextResponse.json({ order: updated.rows[0] });
  } catch {
    await client.query("ROLLBACK");
    return NextResponse.json({ error: "Could not update order status" }, { status: 500 });
  } finally { client.release(); }
}
