import Link from "next/link";
import { redirect } from "next/navigation";
import { getSuperAdmin } from "@/lib/admin";
import MpesaConfigClient from "@/app/mpesa-config-client";

export const dynamic = "force-dynamic";

export default async function PlatformMpesaPage() {
  const user = await getSuperAdmin();
  if (!user) redirect("/admin");
  return <main className="dashboard-shell"><aside className="dashboard-sidebar"><Link className="brand" href="/admin">MobiWave <strong>Commerce</strong></Link><div className="sidebar-label">PLATFORM</div><Link className="sidebar-link" href="/admin">Superadmin overview</Link></aside><section className="dashboard-main"><header className="dashboard-topbar"><div><span className="eyebrow">PLATFORM CONTROL</span><h1>M-Pesa integration</h1></div></header><div className="dashboard-content"><MpesaConfigClient endpoint="/api/admin/mpesa-config" title="Platform Daraja credentials" description="Configure platform-owned Daraja credentials for platform-level payment operations. Merchant-specific credentials remain isolated from these settings."/><footer className="dashboard-footer">MobiWave Commerce · Platform integrations</footer></div></section></main>;
}
