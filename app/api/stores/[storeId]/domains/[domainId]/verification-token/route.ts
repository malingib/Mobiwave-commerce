import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getRequestUser } from "@/lib/request-user";
import { domainVerificationRecordName, domainVerificationRecordValue } from "@/lib/domains";

export const runtime = "nodejs";
type Context = { params: Promise<{ storeId: string; domainId: string }> };

export async function POST(_request: Request, context: Context) {
  const user = await getRequestUser();
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  const { storeId, domainId } = await context.params;
  const token = randomBytes(32).toString("hex");
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.user_id', $1, true)", [user.id]);
    const owner = await client.query("SELECT 1 FROM store_memberships WHERE store_id=$1 AND user_id=$2 AND role='owner'", [storeId, user.id]);
    if (!owner.rowCount) { await client.query("ROLLBACK"); return NextResponse.json({ error: "Store owner access required" }, { status: 403 }); }
    const updated = await client.query(
      `UPDATE store_domains SET verification_token_hash=encode(digest($1,'sha256'),'hex'),
        status='pending_verification', verified_at=NULL, activated_at=NULL,
        provider_status='pending', dns_status='pending', tls_status='pending',
        provider_domain_id=NULL, last_checked_at=NULL, last_error=NULL
        WHERE id=$2 AND store_id=$3 RETURNING id, hostname`,
      [token, domainId, storeId]
    );
    if (!updated.rowCount) { await client.query("ROLLBACK"); return NextResponse.json({ error: "Domain not found" }, { status: 404 }); }
    await client.query("INSERT INTO audit_events (store_id, actor_user_id, action, resource_type, resource_id) VALUES ($1,$2,'domain.verification_token_rotated','store_domain',$3)", [storeId, user.id, domainId]);
    await client.query("COMMIT");
    return NextResponse.json({
      verification_record_name: domainVerificationRecordName(updated.rows[0].hostname),
      verification_record_value: domainVerificationRecordValue(token),
      verification_token_displayed_once: true,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    await client.query("ROLLBACK");
    return NextResponse.json({ error: "Could not generate a new verification token" }, { status: 500 });
  } finally { client.release(); }
}
