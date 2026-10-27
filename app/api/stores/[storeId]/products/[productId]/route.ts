import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getRequestUser } from "@/lib/request-user";

export const runtime = "nodejs";
type Context = { params: Promise<{ storeId: string; productId: string }> };

export async function PATCH(request: Request, context: Context) {
  const user = await getRequestUser();
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  const { storeId, productId } = await context.params;
  let body: { status?: unknown };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid request" }, { status: 400 }); }
  const status = body.status;
  if (status !== "draft" && status !== "active" && status !== "archived") return NextResponse.json({ error: "Invalid product status" }, { status: 400 });
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.user_id', $1, true)", [user.id]);
    const result = await client.query(
      "UPDATE products SET status=$1, updated_at=now() WHERE id=$2 AND store_id=$3 RETURNING id, name, slug, status",
      [status, productId, storeId]
    );
    if (!result.rowCount) { await client.query("ROLLBACK"); return NextResponse.json({ error: "Product not found or access denied" }, { status: 404 }); }
    await client.query(
      "INSERT INTO audit_events (store_id, actor_user_id, action, resource_type, resource_id) VALUES ($1,$2,$3,'product',$4)",
      [storeId, user.id, `product.${status}`, productId]
    );
    await client.query("COMMIT");
    return NextResponse.json({ product: result.rows[0] });
  } catch {
    await client.query("ROLLBACK");
    return NextResponse.json({ error: "Could not update product" }, { status: 500 });
  } finally { client.release(); }
}
