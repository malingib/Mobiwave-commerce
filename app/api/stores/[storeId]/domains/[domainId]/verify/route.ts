import { resolveTxt } from "node:dns/promises";
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
      "SELECT id, hostname, verification_token, status FROM store_domains WHERE id=$1 AND store_id=$2 FOR UPDATE",
      [domainId, storeId],
    );
    if (!result.rowCount) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "Domain not found" }, { status: 404 });
    }
    const domain = result.rows[0];
    if (domain.verified_at || domain.status === "active") {
      await client.query("COMMIT");
      return NextResponse.json({ verified: true, status: domain.status });
    }
    const recordName = domainVerificationRecordName(domain.hostname);
    const expectedValue = domainVerificationRecordValue(domain.verification_token);
    let records: string[] = [];
    try {
      records = (await resolveTxt(recordName)).map(chunks => chunks.join("").trim());
    } catch {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "DNS TXT record was not found yet. Check the record name and value, then retry after DNS propagation." }, { status: 409 });
    }
    if (!records.includes(expectedValue)) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "The DNS TXT record does not match this domain's verification token." }, { status: 409 });
    }
    await client.query(
      "UPDATE store_domains SET status='verified', verified_at=now() WHERE id=$1 AND store_id=$2",
      [domainId, storeId],
    );
    await client.query(
      "INSERT INTO audit_events (store_id, actor_user_id, action, resource_type, resource_id, metadata) VALUES ($1,$2,'domain.verified','store_domain',$3,$4::jsonb)",
      [storeId, user.id, domainId, JSON.stringify({ hostname: domain.hostname, recordName })],
    );
    await client.query("COMMIT");
    return NextResponse.json({ verified: true, status: "verified" });
  } catch {
    await client.query("ROLLBACK");
    return NextResponse.json({ error: "Could not verify domain" }, { status: 500 });
  } finally { client.release(); }
}
