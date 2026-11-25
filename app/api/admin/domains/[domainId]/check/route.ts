import { resolve4, resolve6, resolveCname } from "node:dns/promises";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSuperAdmin } from "@/lib/admin";
import { hasValidTlsCertificate, isPublicAddress, isVercelDnsTarget } from "@/lib/domain-readiness";

export const runtime = "nodejs";
type Context = { params: Promise<{ domainId: string }> };

export async function POST(_request: Request, context: Context) {
  const user = await getSuperAdmin();
  if (!user) return NextResponse.json({ error: "Superadmin access required" }, { status: 403 });
  const { domainId } = await context.params;
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.admin', 'true', true)");
    const found = await client.query("SELECT id, store_id, hostname FROM store_domains WHERE id=$1 FOR UPDATE", [domainId]);
    if (!found.rowCount) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "Domain not found" }, { status: 404 });
    }
    const { store_id: storeId, hostname } = found.rows[0];
    const [cnameResult, ipv4Result, ipv6Result] = await Promise.allSettled([
      resolveCname(hostname),
      resolve4(hostname),
      resolve6(hostname),
    ]);
    const cnames = cnameResult.status === "fulfilled" ? cnameResult.value : [];
    const ipv4 = ipv4Result.status === "fulfilled" ? ipv4Result.value : [];
    const ipv6 = ipv6Result.status === "fulfilled" ? ipv6Result.value : [];
    const addresses = [...ipv4, ...ipv6].filter(isPublicAddress);
    const dnsReady = isVercelDnsTarget(cnames, ipv4) && addresses.length > 0;
    const tlsReady = dnsReady ? await hasValidTlsCertificate(hostname, addresses) : false;
    const dnsStatus = dnsReady ? "ready" : "error";
    const tlsStatus = tlsReady ? "ready" : "error";
    const lastError = !dnsReady
      ? "DNS must resolve to cname.vercel-dns.com or Vercel's 76.76.21.21 A record."
      : !tlsReady
        ? "A valid publicly trusted TLS certificate for this hostname was not presented."
        : null;
    await client.query(
      "UPDATE store_domains SET dns_status=$1, tls_status=$2, last_checked_at=now(), last_error=$3 WHERE id=$4",
      [dnsStatus, tlsStatus, lastError, domainId]
    );
    await client.query(
      "INSERT INTO audit_events (store_id, actor_user_id, action, resource_type, resource_id, metadata) VALUES ($1,$2,'domain.readiness_checked','store_domain',$3,$4::jsonb)",
      [storeId, user.id, domainId, JSON.stringify({ dnsStatus, tlsStatus, cnameRecords: cnames, ipv4Records: ipv4, ipv6Records: ipv6 })]
    );
    await client.query("COMMIT");
    return NextResponse.json({ success: dnsReady && tlsReady, dnsStatus, tlsStatus, cnameRecords: cnames, ipv4Records: ipv4, ipv6Records: ipv6, error: lastError });
  } catch {
    await client.query("ROLLBACK");
    return NextResponse.json({ error: "Could not check domain DNS and TLS readiness" }, { status: 500 });
  } finally { client.release(); }
}
