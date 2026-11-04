import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getRequestUser } from "@/lib/request-user";
import { normalizeCustomHostname, domainVerificationRecordName, domainVerificationRecordValue } from "@/lib/domains";

export const runtime = "nodejs";
type Context = { params: Promise<{ storeId: string }> };

export async function GET(_request: Request, context: Context) {
  const user = await getRequestUser();
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  const { storeId } = await context.params;
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.user_id', $1, true)", [user.id]);
    const member = await client.query(
      "SELECT role FROM store_memberships WHERE store_id=$1 AND user_id=$2 AND role IN ('owner','manager')",
      [storeId, user.id],
    );
    if (!member.rowCount) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "Store owner or manager access required" }, { status: 403 });
    }
    const result = await client.query(
      "SELECT id, hostname, status, verification_token, verified_at, activated_at, created_at FROM store_domains WHERE store_id=$1 ORDER BY created_at DESC",
      [storeId],
    );
    await client.query("COMMIT");
    return NextResponse.json({
      domains: result.rows.map(domain => ({
        ...domain,
        verification_record_name: domainVerificationRecordName(domain.hostname),
        verification_record_value: domainVerificationRecordValue(domain.verification_token),
      })),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    await client.query("ROLLBACK");
    return NextResponse.json({ error: "Could not load custom domains" }, { status: 500 });
  } finally { client.release(); }
}

export async function POST(request: Request, context: Context) {
  const user = await getRequestUser();
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  const { storeId } = await context.params;
  let body: { hostname?: unknown };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid request body" }, { status: 400 }); }
  const hostname = typeof body.hostname === "string"
    ? normalizeCustomHostname(body.hostname, process.env.NEXT_PUBLIC_ROOT_DOMAIN || "shop.mobiwave.co.ke")
    : null;
  if (!hostname) return NextResponse.json({ error: "Enter a valid external domain name, without https:// or a path." }, { status: 400 });

  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.user_id', $1, true)", [user.id]);
    const member = await client.query(
      "SELECT role FROM store_memberships WHERE store_id=$1 AND user_id=$2 AND role IN ('owner','manager')",
      [storeId, user.id],
    );
    if (!member.rowCount) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "Store owner or manager access required" }, { status: 403 });
    }
    const inserted = await client.query(
      "INSERT INTO store_domains (store_id, hostname) VALUES ($1,$2) RETURNING id, hostname, status, verification_token, verified_at, activated_at, created_at",
      [storeId, hostname],
    );
    const domain = inserted.rows[0];
    await client.query(
      "INSERT INTO audit_events (store_id, actor_user_id, action, resource_type, resource_id, metadata) VALUES ($1,$2,'domain.created','store_domain',$3,$4::jsonb)",
      [storeId, user.id, domain.id, JSON.stringify({ hostname })],
    );
    await client.query("COMMIT");
    return NextResponse.json({
      domain: {
        ...domain,
        verification_record_name: domainVerificationRecordName(domain.hostname),
        verification_record_value: domainVerificationRecordValue(domain.verification_token),
      },
    }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    await client.query("ROLLBACK");
    if ((error as { code?: string }).code === "23505") {
      return NextResponse.json({ error: "This domain is already registered." }, { status: 409 });
    }
    return NextResponse.json({ error: "Could not register this domain" }, { status: 500 });
  } finally { client.release(); }
}
