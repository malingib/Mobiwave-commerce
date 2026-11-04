import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSuperAdmin } from "@/lib/admin";

export const runtime = "nodejs";
type Context = { params: Promise<{ domainId: string }> };

export async function PATCH(request: Request, context: Context) {
  const user = await getSuperAdmin();
  if (!user) return NextResponse.json({ error: "Superadmin access required" }, { status: 403 });
  const { domainId } = await context.params;
  let body: { status?: unknown };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid request body" }, { status: 400 }); }
  if (body.status !== "active" && body.status !== "disabled") {
    return NextResponse.json({ error: "Only activate or disable actions are supported." }, { status: 400 });
  }

  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.admin', 'true', true)");
    const current = await client.query(
      "SELECT id, store_id, hostname, status, verified_at FROM store_domains WHERE id=$1 FOR UPDATE",
      [domainId],
    );
    if (!current.rowCount) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "Domain not found" }, { status: 404 });
    }
    const domain = current.rows[0];
    if (body.status === "active" && !domain.verified_at) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "Verify domain ownership before activation." }, { status: 409 });
    }
    await client.query(
      "UPDATE store_domains SET status=$1::domain_status, activated_at=CASE WHEN $1='active' THEN now() ELSE NULL END WHERE id=$2",
      [body.status, domainId],
    );
    await client.query(
      "INSERT INTO audit_events (store_id, actor_user_id, action, resource_type, resource_id, metadata) VALUES ($1,$2,$3,'store_domain',$4,$5::jsonb)",
      [domain.store_id, user.id, body.status === "active" ? "domain.activated" : "domain.disabled", domainId, JSON.stringify({ hostname: domain.hostname })],
    );
    await client.query("COMMIT");
    return NextResponse.json({ ok: true, status: body.status });
  } catch {
    await client.query("ROLLBACK");
    return NextResponse.json({ error: "Could not update domain status" }, { status: 500 });
  } finally { client.release(); }
}
