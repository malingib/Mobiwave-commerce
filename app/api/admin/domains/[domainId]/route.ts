import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSuperAdmin } from "@/lib/admin";

export const runtime = "nodejs";
type Context = { params: Promise<{ domainId: string }> };

export async function PATCH(request: Request, context: Context) {
  const user = await getSuperAdmin();
  if (!user) return NextResponse.json({ error: "Superadmin access required" }, { status: 403 });
  const { domainId } = await context.params;
  let body: { status?: unknown; providerStatus?: unknown; dnsStatus?: unknown; tlsStatus?: unknown; isPrimary?: unknown; providerDomainId?: unknown };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid request body" }, { status: 400 }); }

  const validStatus = body.status === undefined || body.status === "active" || body.status === "disabled";
  const validProvider = body.providerStatus === undefined || body.providerStatus === "attached" || body.providerStatus === "error";
  const validDns = body.dnsStatus === undefined || body.dnsStatus === "ready" || body.dnsStatus === "error" || body.dnsStatus === "pending";
  const validTls = body.tlsStatus === undefined || body.tlsStatus === "ready" || body.tlsStatus === "error" || body.tlsStatus === "pending";
  if (!validStatus || !validProvider || !validDns || !validTls ||
      (body.isPrimary !== undefined && typeof body.isPrimary !== "boolean") ||
      (body.providerDomainId !== undefined && (typeof body.providerDomainId !== "string" || body.providerDomainId.length > 256)) ||
      (body.status === undefined && body.providerStatus === undefined && body.dnsStatus === undefined && body.tlsStatus === undefined && body.isPrimary === undefined)) {
    return NextResponse.json({ error: "Invalid domain lifecycle update." }, { status: 400 });
  }

  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.admin', 'true', true)");
    const current = await client.query(
      `SELECT id, store_id, hostname, status, verified_at, provider_status, dns_status, tls_status, is_primary
         FROM store_domains WHERE id=$1 FOR UPDATE`,
      [domainId]
    );
    if (!current.rowCount) { await client.query("ROLLBACK"); return NextResponse.json({ error: "Domain not found" }, { status: 404 }); }
    const domain = current.rows[0];
    const nextProvider = body.providerStatus ?? domain.provider_status;
    const nextDns = body.dnsStatus ?? domain.dns_status;
    const nextTls = body.tlsStatus ?? domain.tls_status;
    const nextStatus = body.status ?? domain.status;

    if (nextStatus === "active") {
      if (!domain.verified_at) { await client.query("ROLLBACK"); return NextResponse.json({ error: "Verify domain ownership before activation." }, { status: 409 }); }
      if (nextProvider !== "attached" || nextDns !== "ready" || nextTls !== "ready") {
        await client.query("ROLLBACK");
        return NextResponse.json({ error: "Vercel attachment, DNS routing and valid TLS must all be confirmed before activation." }, { status: 409 });
      }
      if (!domain.hostname.startsWith("www.")) {
        const wwwHost = `www.${domain.hostname}`;
        const www = await client.query(
          "SELECT id FROM store_domains WHERE store_id=$1 AND hostname=$2 AND status='active' AND provider_status='attached' AND dns_status='ready' AND tls_status='ready'",
          [domain.store_id, wwwHost]
        );
        if (!www.rowCount) {
          await client.query("ROLLBACK");
          return NextResponse.json({ error: `Activate and verify ${wwwHost} first. The apex hostname redirects to the www canonical host.` }, { status: 409 });
        }
      }
    }

    if (body.isPrimary === true) {
      if (nextStatus !== "active" || nextProvider !== "attached" || nextDns !== "ready" || nextTls !== "ready") {
        await client.query("ROLLBACK");
        return NextResponse.json({ error: "Only an active, provider-attached domain with ready DNS and TLS can be primary." }, { status: 409 });
      }
      await client.query("UPDATE store_domains SET is_primary=false WHERE store_id=$1", [domain.store_id]);
    }

    const canonicalTarget = !domain.hostname.startsWith("www.") && nextStatus === "active"
      ? `https://www.${domain.hostname}`
      : null;
    await client.query(
      `UPDATE store_domains
          SET status=$1::domain_status,
              provider_status=$2,
              dns_status=$3,
              tls_status=$4,
              provider_domain_id=COALESCE($5,provider_domain_id),
              is_primary=CASE WHEN $6::boolean THEN true WHEN $7::boolean THEN false ELSE is_primary END,
              canonical_target=CASE WHEN $1='disabled' THEN NULL WHEN $8::boolean THEN NULL ELSE COALESCE($9,canonical_target) END,
              activated_at=CASE WHEN $1='active' THEN COALESCE(activated_at,now()) ELSE NULL END,
              last_error=CASE WHEN $2='error' OR $3='error' OR $4='error' THEN 'A domain readiness check failed' ELSE NULL END
        WHERE id=$10`,
      [nextStatus, nextProvider, nextDns, nextTls, body.providerDomainId ?? null, body.isPrimary === true, nextStatus === "disabled", body.isPrimary === true, canonicalTarget, domainId]
    );
    await client.query(
      "INSERT INTO audit_events (store_id, actor_user_id, action, resource_type, resource_id, metadata) VALUES ($1,$2,$3,'store_domain',$4,$5::jsonb)",
      [domain.store_id, user.id, body.status === "active" ? "domain.activated" : body.status === "disabled" ? "domain.disabled" : "domain.lifecycle_updated", domainId, JSON.stringify({ providerStatus: nextProvider, dnsStatus: nextDns, tlsStatus: nextTls, isPrimary: body.isPrimary })]
    );
    await client.query("COMMIT");
    return NextResponse.json({ ok: true, status: nextStatus, providerStatus: nextProvider, dnsStatus: nextDns, tlsStatus: nextTls, isPrimary: body.isPrimary === true || domain.is_primary });
  } catch {
    await client.query("ROLLBACK");
    return NextResponse.json({ error: "Could not update domain lifecycle" }, { status: 500 });
  } finally { client.release(); }
}
