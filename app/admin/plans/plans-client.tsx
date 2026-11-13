"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowLeft, CheckCircle2, CreditCard, Globe, Save, ShieldCheck, Store } from "lucide-react";

type Plan = {
  code: string;
  name: string;
  description: string;
  amount_minor: number | string | null;
  currency: string;
  billing_interval: "monthly" | "yearly";
  is_active: boolean;
  limits: { maxProducts?: number; maxDomains?: number; maxMembers?: number };
  features: string[];
};

export default function PlansClient({ email }: { email: string }) {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function load() {
    try {
      const response = await fetch("/api/admin/plans", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not load plans");
      setPlans(data.plans || []);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not load plans"); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);

  function updatePlan(code: string, patch: Partial<Plan>) {
    setPlans(current => current.map(plan => plan.code === code ? { ...plan, ...patch } : plan));
  }

  async function save(plan: Plan) {
    setBusy(plan.code); setError(""); setNotice("");
    try {
      const amountMinor = plan.amount_minor === null || plan.amount_minor === undefined
        ? null
        : Math.round(Number(plan.amount_minor) * (typeof plan.amount_minor === "string" && plan.amount_minor.includes(".") ? 100 : 1));
      const response = await fetch("/api/admin/plans", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          code: plan.code,
          amountMinor,
          isActive: plan.is_active,
          billingInterval: plan.billing_interval,
          limits: plan.limits || {},
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not save plan");
      setNotice(`${plan.name} plan settings saved.`);
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not save plan"); }
    finally { setBusy(""); }
  }

  return <main className="dashboard-shell">
    <aside className="dashboard-sidebar">
      <Link className="brand" href="/"><span className="brand-mark"><Store size={18}/></span><span>MobiWave <strong>Commerce</strong></span></Link>
      <div className="sidebar-label">PLATFORM</div>
      <Link className="sidebar-link" href="/admin"><ShieldCheck size={17}/> Superadmin</Link>
      <div className="sidebar-link active"><CreditCard size={17}/> Subscription plans</div>
      <Link className="sidebar-link" href="/admin/domains"><Globe size={17}/> Custom domains</Link><Link className="sidebar-link" href="/admin/reconciliation"><CheckCircle2 size={17}/> Payment reconciliation</Link><Link className="sidebar-link" href="/admin/integrations/mpesa">M-Pesa integration</Link>
      <Link className="sidebar-link" href="/dashboard"><ArrowLeft size={17}/> Merchant dashboard</Link>
      <div className="sidebar-bottom"><div className="user-avatar">A</div><div className="user-details"><b>Platform admin</b><small>{email}</small></div></div>
    </aside>
    <section className="dashboard-main">
      <header className="dashboard-topbar"><div><span className="eyebrow">PLATFORM CONTROL</span><h1>Subscription plans</h1></div><span className="free-pill">{plans.length} PLANS</span></header>
      <div className="dashboard-content">
        <Link className="back-link" href="/admin"><ArrowLeft size={15}/> Back to superadmin</Link>
        {error && <p className="form-error dashboard-error" role="alert">{error}</p>}
        {notice && <p className="success-message dashboard-notice" role="status">{notice}</p>}
        <section className="workspace-panel">
          <div className="panel-heading"><div><h3>Plan catalogue and entitlements</h3><p>Set subscription pricing and optional quotas. Blank quotas mean unlimited.</p></div><CreditCard size={20}/></div>
          {loading ? <p className="empty-state">Loading plans…</p> : <div className="admin-store-list">
            {plans.map(plan=><article className="admin-store-row" key={plan.code} style={{alignItems:"flex-start"}}>
              <div className="store-avatar"><CreditCard size={18}/></div>
              <div className="admin-store-info" style={{minWidth:180,flex:1}}>
                <b>{plan.name} · {plan.code}</b><small>{plan.description}</small>
                <label>Monthly price (KES)</label>
                <input type="number" min="0" step="0.01" value={plan.amount_minor===null?"":(Number(plan.amount_minor)/100).toFixed(2)} placeholder={plan.code==="free"?"0.00":"Not configured"} disabled={plan.code==="free"} onChange={e=>updatePlan(plan.code,{amount_minor:e.target.value===""?null:Math.round(Number(e.target.value)*100)})}/>
                <label>Maximum products <span>blank = unlimited</span></label>
                <input type="number" min="0" step="1" value={plan.limits?.maxProducts??""} onChange={e=>updatePlan(plan.code,{limits:{...plan.limits,maxProducts:e.target.value===""?undefined:Number(e.target.value)}})}/>
                <label>Maximum custom domains <span>blank = unlimited</span></label>
                <input type="number" min="0" step="1" value={plan.limits?.maxDomains??""} onChange={e=>updatePlan(plan.code,{limits:{...plan.limits,maxDomains:e.target.value===""?undefined:Number(e.target.value)}})}/>
                <label>Maximum members <span>blank = unlimited</span></label>
                <input type="number" min="0" step="1" value={plan.limits?.maxMembers??""} onChange={e=>updatePlan(plan.code,{limits:{...plan.limits,maxMembers:e.target.value===""?undefined:Number(e.target.value)}})}/>
                <label className="checkbox-label"><input type="checkbox" checked={plan.is_active} onChange={e=>updatePlan(plan.code,{is_active:e.target.checked})}/> Available for purchase</label>
                <button className="button button-dark" disabled={busy===plan.code} onClick={()=>void save(plan)}>{busy===plan.code?"Saving…":"Save plan"} <Save size={15}/></button>
              </div>
            </article>)}
          </div>}
        </section>
        <p className="billing-note">Paid plan prices are deliberately unconfigured until MobiWave sets approved commercial rates. A plan cannot be purchased through M-Pesa until it has a positive KES price and platform Daraja payments are enabled.</p>
        <footer className="dashboard-footer">Signed in as {email} · Price and quota changes are audited.</footer>
      </div>
    </section>
  </main>;
}
