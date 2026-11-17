import Link from "next/link";
import { redirect } from "next/navigation";
import { getRequestUser } from "@/lib/request-user";
import { db } from "@/lib/db";
import MetaChannelsClient from "@/app/meta-channels-client";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ storeId: string }> };

export default async function MerchantChannelsPage({ params }: Context) {
  const user = await getRequestUser();
  if (!user) redirect("/login");
  const { storeId } = await params;
  const client = await db.connect();
  let allowed = false;
  let connections: Array<{
    id: string; channel: "whatsapp" | "instagram"; display_name: string | null;
    status: string; ownership_mode: string; asset_owner_type: string;
    connected_at: string | null; expires_at: string | null;
  }> = [];
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.user_id',$1,true)", [user.id]);
    const membership = await client.query(
      "SELECT 1 FROM store_memberships WHERE store_id=$1 AND user_id=$2 AND role IN ('owner','manager')",
      [storeId, user.id],
    );
    allowed = Boolean(membership.rowCount);
    if (allowed) {
      const result = await client.query(
        \`SELECT c.id,c.channel,c.display_name,c.status,c.ownership_mode,c.asset_owner_type,
                c.connected_at,cred.expires_at
           FROM channel_connections c
           LEFT JOIN channel_credentials cred
             ON cred.store_id=c.store_id AND cred.id=c.credential_ref AND cred.revoked_at IS NULL
          WHERE c.store_id=$1 AND c.channel IN ('whatsapp','instagram')
          ORDER BY c.created_at DESC\`,
        [storeId],
      );
      connections = result.rows.map(row => ({
        ...row,
        id: String(row.id),
        channel: row.channel as "whatsapp" | "instagram",
        connected_at: row.connected_at ? new Date(row.connected_at).toISOString() : null,
        expires_at: row.expires_at ? new Date(row.expires_at).toISOString() : null,
      }));
    }
    await client.query("COMMIT");
  } catch {
    await client.query("ROLLBACK");
  } finally {
    client.release();
  }
  if (!allowed) redirect("/dashboard");

  return (
    <main className="dashboard-shell">
      <aside className="dashboard-sidebar">
        <Link className="brand" href="/dashboard">MobiWave <strong>Commerce</strong></Link>
        <div className="sidebar-label">STORE</div>
        <Link className="sidebar-link" href={\`/dashboard/\${storeId}/products\`}>Products</Link>
        <Link className="sidebar-link" href={\`/dashboard/\${storeId}/orders\`}>Orders</Link>
        <Link className="sidebar-link" href={\`/dashboard/\${storeId}/billing\`}>Billing</Link>
        <Link className="sidebar-link active" href={\`/dashboard/\${storeId}/integrations/channels\`}>Sales channels</Link>
        <Link className="sidebar-link" href={\`/dashboard/\${storeId}/integrations/mpesa\`}>M-Pesa integration</Link>
      </aside>
      <section className="dashboard-main">
        <header className="dashboard-topbar"><div><span className="eyebrow">MERCHANT WORKSPACE</span><h1>Sales channels</h1></div></header>
        <MetaChannelsClient storeId={storeId} initialConnections={connections} appId={process.env.META_APP_ID || ""} graphVersion={process.env.META_GRAPH_API_VERSION || "v27.0"} />
        <footer className="dashboard-footer">MobiWave Commerce · Social Commerce</footer>
      </section>
    </main>
  );
}
