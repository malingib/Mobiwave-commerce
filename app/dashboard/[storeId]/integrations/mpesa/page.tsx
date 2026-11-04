import Link from "next/link";
import { redirect } from "next/navigation";
import { getRequestUser } from "@/lib/request-user";
import { db } from "@/lib/db";
import MpesaConfigClient from "@/app/mpesa-config-client";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ storeId: string }> };

export default async function MerchantMpesaPage({ params }: Context) {
  const user = await getRequestUser();
  if (!user) redirect("/login");
  const { storeId } = await params;
  const client = await db.connect();
  let allowed = false;
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.user_id', $1, true)", [user.id]);
    const result = await client.query("SELECT 1 FROM store_memberships WHERE store_id=$1 AND user_id=$2 AND role IN ('owner','manager')", [storeId, user.id]);
    allowed = Boolean(result.rowCount);
    await client.query("COMMIT");
  } catch {
    await client.query("ROLLBACK");
  } finally { client.release(); }
  if (!allowed) redirect("/dashboard");
  return <main className="dashboard-shell"><aside className="dashboard-sidebar"><Link className="brand" href="/dashboard">MobiWave <strong>Commerce</strong></Link><div className="sidebar-label">STORE</div><Link className="sidebar-link" href={`/dashboard/${storeId}/products`}>Products</Link><Link className="sidebar-link" href={`/dashboard/${storeId}/orders`}>Orders</Link><Link className="sidebar-link" href={`/dashboard/${storeId}/billing`}>Billing</Link><Link className="sidebar-link active" href={`/dashboard/${storeId}/integrations/mpesa`}>M-Pesa integration</Link></aside><section className="dashboard-main"><header className="dashboard-topbar"><div><span className="eyebrow">MERCHANT WORKSPACE</span><h1>M-Pesa integration</h1></div></header><div className="dashboard-content"><MpesaConfigClient endpoint={`/api/stores/${storeId}/mpesa-config`} title="Your Daraja credentials" description="Connect your own Safaricom Daraja app. Only this store's owner or manager can manage these settings."/><footer className="dashboard-footer">MobiWave Commerce · Store integrations</footer></div></section></main>;
}
