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
      "SELECT s.id, s.name, s.slug, sub.plan_code, sub.status AS subscription_status, sub.current_period_start, sub.current_period_end FROM stores s LEFT JOIN subscriptions sub ON sub.store_id=s.id WHERE s.id=$1 LIMIT 1",
      [storeId]
    );
    await client.query("COMMIT");
    if (!result.rowCount) return NextResponse.json({ error: "Store not found or access denied" }, { status: 404 });
    return NextResponse.json({ billing: result.rows[0] });
  } catch {
    await client.query("ROLLBACK");
    return NextResponse.json({ error: "Could not load billing details" }, { status: 500 });
  } finally { client.release(); }
}
