"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowLeft, CheckCircle2, CreditCard, Globe, ShieldCheck, Store } from "lucide-react";

type DomainRow = {
  id: string;
  store_id: string;
  hostname: string;
  status: string;
  verified_at: string | null;
  activated_at: string | null;
  created_at: string;
  store_name: string;
  store_slug: string;
};

export default function AdminDomainsClient({ email }: { email: string }) {
  const [domains, setDomains] = useState<DomainRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function load() {
    try {
      const response = await fetch("/api/admin/domains", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not load domains");
      setDomains(data.domains || []);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not load domains"); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);

  async function setStatus(domain: DomainRow, status: "active" | "disabled") {
    setBusy(domain.id); setError(""); setNotice("");
    try {
      const response = await fetch(`/api/admin/domains/${domain.id}`, {
        method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ status }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not update domain");
      setNotice(status === "active" ? "Domain activated for storefront routing." : "Domain disabled.");
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not update domain"); }
    finally { setBusy(""); }
  }

  return <main className="dashboard-shell">
    <aside className="dashboard-sidebar">
      <Link className="brand" href="/"><span className="brand-mark"><Store size={18}/></span><span>MobiWave <strong>Commerce</strong></span></Link>
      <div className="sidebar-label">PLATFORM</div>
      <Link className="sidebar-link" href="/admin"><ShieldCheck size={17}/> Superadmin</Link>
      <div className="sidebar-link active"><Globe size={17}/> Custom domains</div>
      <Link className="sidebar-link" href="/admin/integrations/mpesa">M-Pesa integration</Link><Link className="sidebar-link" href="/admin/plans"><CreditCard size={17}/> Subscription plans</Link><Link className="sidebar-link" href="/admin/reconciliation"><CheckCircle2 size={17}/> Payment reconciliation</Link>
      <Link className="sidebar-link" href="/dashboard"><ArrowLeft size={17}/> Merchant dashboard</Link>
      <div className="sidebar-bottom"><div className="user-avatar">A</div><div className="user-details"><b>Platform admin</b><small>{email}</small></div></div>
    </aside>
    <section className="dashboard-main">
      <header className="dashboard-topbar"><div><span className="eyebrow">PLATFORM CONTROL</span><h1>Custom domains</h1></div><span className="free-pill">{domains.length} REQUESTS</span></header>
      <div className="dashboard-content">
        {error && <p className="form-error dashboard-error" role="alert">{error}</p>}
        {notice && <p className="success-message dashboard-notice" role="status">{notice}</p>}
        <section className="workspace-panel">
          <div className="panel-heading"><div><h3>Domain activation queue</h3><p>Activate only after DNS ownership is verified and the hostname has been attached to the Vercel project.</p></div><Globe size={20}/></div>
          {loading ? <p className="empty-state">Loading domain requests…</p> : domains.length === 0 ? <p className="empty-state">No custom domain requests yet.</p> : <div className="admin-store-list">
            {domains.map(domain=><article className="admin-store-row" key={domain.id}>
              <div className="store-avatar"><Globe size={18}/></div>
              <div className="admin-store-info"><b>{domain.hostname}</b><small>{domain.store_name} · {domain.store_slug}.shop.mobiwave.co.ke</small><small>Status: {domain.status.replaceAll("_"," ")}</small></div>
              {domain.status==="verified" && <button className="status-toggle" disabled={busy===domain.id} onClick={()=>void setStatus(domain,"active")}>{busy===domain.id?"Saving…":"Activate"}</button>}
              {domain.status==="active" && <button className="status-toggle" disabled={busy===domain.id} onClick={()=>void setStatus(domain,"disabled")}>{busy===domain.id?"Saving…":"Disable"}</button>}
              {domain.status==="pending_verification" && <span className="table-status">Awaiting DNS</span>}
              {domain.status==="disabled" && domain.verified_at && <button className="status-toggle" disabled={busy===domain.id} onClick={()=>void setStatus(domain,"active")}>{busy===domain.id?"Saving…":"Reactivate"}</button>}
            </article>)}
          </div>}
        </section>
        <footer className="dashboard-footer">Signed in as {email} · Domain activations are audited.</footer>
      </div>
    </section>
  </main>;
}
