import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSuperAdmin } from "@/lib/admin";

export const runtime = "nodejs";

export async function GET() {
  const user = await getSuperAdmin();
  if (!user) return NextResponse.json({ error: "Superadmin access required" }, { status: 403 });
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.admin', 'true', true)");
    const result = await client.query(
      `SELECT d.id, d.store_id, d.hostname, d.status, d.verified_at, d.activated_at, d.created_at,
              s.name AS store_name, s.slug AS store_slug
         FROM store_domains d
         JOIN stores s ON s.id=d.store_id
        ORDER BY d.created_at DESC`,
    );
    await client.query("COMMIT");
    return NextResponse.json({ domains: result.rows }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    await client.query("ROLLBACK");
    return NextResponse.json({ error: "Could not load domain requests" }, { status: 500 });
  } finally { client.release(); }
}
