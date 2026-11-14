"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { ArrowLeft, Globe, Store } from "lucide-react";

type DomainRow = {
  id: string;
  hostname: string;
  status: string;
  verification_token: string;
  verification_record_name: string;
  verification_record_value: string;
  verified_at: string | null;
  activated_at: string | null;
};

export default function DomainsClient({ storeId, userName }: { storeId: string; userName: string }) {
  const [domains, setDomains] = useState<DomainRow[]>([]);
  const [hostname, setHostname] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/stores/${storeId}/domains`, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not load domains");
      setDomains(data.domains || []);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not load domains"); }
    finally { setLoading(false); }
  }, [storeId]);
  useEffect(() => {
    let active = true;
    fetch(`/api/stores/${storeId}/domains`, { cache: "no-store" })
      .then(async response => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Could not load domains");
        if (active) setDomains(data.domains || []);
      })
      .catch(error => { if (active) setError(error instanceof Error ? error.message : "Could not load domains"); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [storeId]);

  async function addDomain(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy("add"); setError(""); setNotice("");
    try {
      const response = await fetch(`/api/stores/${storeId}/domains`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ hostname }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not add domain");
      setHostname("");
      setNotice("Domain registered. Add the TXT record below, then verify ownership.");
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not add domain"); }
    finally { setBusy(""); }
  }

  async function verify(domain: DomainRow) {
    setBusy(domain.id); setError(""); setNotice("");
    try {
      const response = await fetch(`/api/stores/${storeId}/domains/${domain.id}/verify`, { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Domain verification failed");
      setNotice("Domain ownership verified. MobiWave support must attach the hostname to the Vercel project before it can be activated.");
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Domain verification failed"); }
    finally { setBusy(""); }
  }

  return <main className="dashboard-shell">
    <aside className="dashboard-sidebar">
      <Link className="brand" href="/dashboard"><span className="brand-mark"><Store size={18}/></span><span>MobiWave <strong>Commerce</strong></span></Link>
      <div className="sidebar-label">STORE MANAGEMENT</div>
      <Link className="sidebar-link" href="/dashboard"><ArrowLeft size={17}/> All stores</Link>
      <div className="sidebar-link active"><Globe size={17}/> Custom domains</div>
      <div className="sidebar-bottom"><div className="user-avatar">{userName.slice(0,1).toUpperCase()}</div><div className="user-details"><b>{userName}</b><small>Store owner</small></div></div>
    </aside>
    <section className="dashboard-main">
      <header className="dashboard-topbar"><div><span className="eyebrow">STOREFRONT SETTINGS</span><h1>Custom domains</h1></div><span className="free-pill">{domains.length} DOMAINS</span></header>
      <div className="dashboard-content">
        <Link className="back-link" href="/dashboard"><ArrowLeft size={15}/> Back to stores</Link>
        {error && <p className="form-error dashboard-error" role="alert">{error}</p>}
        {notice && <p className="success-message dashboard-notice" role="status">{notice}</p>}
        <section className="workspace-panel">
          <div className="panel-heading"><div><h3>Connect your domain</h3><p>Register an external domain and verify that you control its DNS.</p></div><Globe size={20}/></div>
          <form className="auth-form store-form" onSubmit={addDomain}>
            <label htmlFor="custom-domain">Domain name</label>
            <input id="custom-domain" value={hostname} onChange={e=>setHostname(e.target.value)} placeholder="shop.example.com" autoCapitalize="none" autoCorrect="off" required />
            <button className="button button-dark" disabled={busy==="add"}>{busy==="add"?"Registering…":"Add custom domain"}</button>
          </form>
          <p className="billing-note">After adding the domain, create the DNS TXT record shown below. You must also attach the hostname to the MobiWave Commerce Vercel project; activation is restricted to verified domains.</p>
        </section>
        <section className="workspace-panel">
          <div className="panel-heading"><div><h3>Your domains</h3><p>Ownership verification and activation status.</p></div></div>
          {loading ? <p className="empty-state">Loading domains…</p> : domains.length === 0 ? <p className="empty-state">No custom domains have been registered.</p> : <div className="admin-store-list">
            {domains.map(domain=><article className="admin-store-row" key={domain.id}>
              <div className="store-avatar"><Globe size={18}/></div>
              <div className="admin-store-info"><b>{domain.hostname}</b><small>Status: {domain.status.replaceAll("_"," ")}</small>
                {domain.status==="pending_verification" && <><small>TXT host: <code>{domain.verification_record_name}</code></small><small>TXT value: <code>{domain.verification_record_value}</code></small></>}
                {domain.status==="verified" && <small>Verified. Waiting for Vercel domain attachment and platform activation.</small>}
              </div>
              {domain.status==="pending_verification" && <button className="status-toggle" disabled={busy===domain.id} onClick={()=>void verify(domain)}>{busy===domain.id?"Checking…":"Verify DNS"}</button>}
              {domain.status==="active" && <span className="order-status-pill status-active">active</span>}
            </article>)}
          </div>}
        </section>
        <footer className="dashboard-footer">MobiWave Commerce · Domain verification is separate from Vercel DNS/TLS activation.</footer>
      </div>
    </section>
  </main>;
}
