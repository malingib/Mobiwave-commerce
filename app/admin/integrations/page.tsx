import Link from "next/link";
import { redirect } from "next/navigation";
import { getSuperAdmin } from "@/lib/admin";
import ProviderConfigClient from "./provider-config-client";

export const dynamic = "force-dynamic";

export default async function PlatformIntegrationsPage() {
  const user = await getSuperAdmin();
  if (!user) redirect("/admin");
  return <main className="dashboard-shell">
    <aside className="dashboard-sidebar">
      <Link className="brand" href="/admin">MobiWave <strong>Commerce</strong></Link>
      <div className="sidebar-label">PLATFORM</div>
      <Link className="sidebar-link" href="/admin">Superadmin overview</Link>
      <Link className="sidebar-link" href="/admin/integrations/mpesa">M-Pesa integration</Link>
      <Link className="sidebar-link active" href="/admin/integrations">Provider integrations</Link>
    </aside>
    <section className="dashboard-main">
      <header className="dashboard-topbar"><div><span className="eyebrow">PLATFORM CONTROL</span><h1>Provider integrations</h1></div></header>
      <div className="dashboard-content">
        <ProviderConfigClient />
        <footer className="dashboard-footer">Platform application credentials are encrypted at rest and write-only. Infrastructure secrets are not configurable here.</footer>
      </div>
    </section>
  </main>;
}
