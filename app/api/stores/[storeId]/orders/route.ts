import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getRequestUser } from "@/lib/request-user";

export const runtime = "nodejs";

export async function GET(_request: Request, context: { params: Promise<{ storeId: string }> }) {
  const user = await getRequestUser();
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  const { storeId } = await context.params;
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.user_id', $1, true)", [user.id]);
    const result = await client.query(
      "SELECT id, order_number, customer_name, customer_email, customer_phone, delivery_address, status, payment_status, payment_method, currency, subtotal_minor, delivery_fee_minor, total_minor, customer_note, created_at FROM orders WHERE store_id=$1 ORDER BY created_at DESC LIMIT 100",
      [storeId]
    );
    await client.query("COMMIT");
    return NextResponse.json({ orders: result.rows });
  } catch {
    await client.query("ROLLBACK");
    return NextResponse.json({ error: "Could not load orders. Confirm you have access to this store." }, { status: 500 });
  } finally { client.release(); }
}
