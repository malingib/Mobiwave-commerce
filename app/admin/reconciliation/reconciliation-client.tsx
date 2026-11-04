"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowLeft, CheckCircle2, CreditCard, Store } from "lucide-react";

type Attempt = {
  id: string; store_id: string; amount_minor: string | number; currency: string; status: string;
  provider_reference: string | null; checkout_request_id: string | null; customer_phone: string;
  store_name: string; resource_label: string; created_at: string; attempt_type: "order" | "subscription";
};

export default function ReconciliationClient({ email }: { email: string }) {
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [values, setValues] = useState<Record<string, { receipt: string; phone: string; amountKes: string; reason: string }>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function load() {
    setLoading(true); setError("");
    try {
      const response = await fetch("/api/admin/reconciliation", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not load reconciliation queue");
      setAttempts(data.attempts || []);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not load reconciliation queue"); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);

  function update(id: string, patch: Partial<{ receipt: string; phone: string; amountKes: string; reason: string }>) {
    setValues(current => ({ ...current, [id]: { receipt: "", phone: "", amountKes: "", reason: "", ...current[id], ...patch } }));
  }

  async function reconcile(attempt: Attempt, action: "mark_paid" | "mark_failed") {
    const value = values[attempt.id] || { receipt: "", phone: "", amountKes: "", reason: "" };
    setBusy(attempt.id); setError(""); setNotice("");
    try {
      const response = await fetch("/api/admin/reconciliation", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          attemptType: attempt.attempt_type,
          attemptId: attempt.id,
          action,
          providerReference: value.receipt,
          verifiedAmountMinor: Math.round(Number(value.amountKes) * 100),
          verifiedPhone: value.phone,
          reason: value.reason,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not reconcile payment");
      setNotice(`${attempt.resource_label} marked ${action === "mark_paid" ? "paid" : "failed"}.`);
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not reconcile payment"); }
    finally { setBusy(""); }
  }

  const money = (minor: number | string, currency: string) => new Intl.NumberFormat("en-KE", { style: "currency", currency, maximumFractionDigits: 2 }).format(Number(minor) / 100);

  return <main className="dashboard-shell">
    <aside className="dashboard-sidebar">
      <Link className="brand" href="/"><span className="brand-mark"><Store size={18}/></span><span>MobiWave <strong>Commerce</strong></span></Link>
      <div className="sidebar-label">PLATFORM</div>
      <Link className="sidebar-link" href="/admin">Superadmin</Link>
      <div className="sidebar-link active"><CreditCard size={17}/> Payment reconciliation</div>
      <Link className="sidebar-link" href="/admin/plans">Subscription plans</Link>
      <Link className="sidebar-link" href="/admin/domains">Custom domains</Link>
      <Link className="sidebar-link" href="/dashboard"><ArrowLeft size={17}/> Merchant dashboard</Link>
      <div className="sidebar-bottom"><div className="user-avatar">A</div><div className="user-details"><b>Platform admin</b><small>{email}</small></div></div>
    </aside>
    <section className="dashboard-main">
      <header className="dashboard-topbar"><div><span className="eyebrow">PAYMENTS</span><h1>Reconciliation queue</h1></div><span className="free-pill">{attempts.length} REVIEW REQUIRED</span></header>
      <div className="dashboard-content">
        {error && <p className="form-error dashboard-error" role="alert">{error}</p>}
        {notice && <p className="success-message dashboard-notice" role="status">{notice}</p>}
        <section className="workspace-panel">
          <div className="panel-heading"><div><h3>Uncertain M-Pesa payments</h3><p>Only reconcile against the actual Safaricom transaction record. All decisions are audited.</p></div><CheckCircle2 size={20}/></div>
          {loading ? <p className="empty-state">Loading payments…</p> : attempts.length === 0 ? <p className="empty-state">No payments currently require reconciliation.</p> : <div className="admin-store-list">
            {attempts.map(attempt => {
              const value = values[attempt.id] || { receipt: "", phone: "", reason: "" };
              return <article className="admin-store-row" key={attempt.id} style={{alignItems:"flex-start"}}>
                <div className="store-avatar"><CreditCard size={18}/></div>
                <div className="admin-store-info" style={{flex:1,minWidth:200}}>
                  <b>{attempt.store_name} · {attempt.resource_label}</b>
                  <small>{attempt.attempt_type} · {money(attempt.amount_minor,attempt.currency)} · {attempt.customer_phone}</small>
                  <small>Checkout: {attempt.checkout_request_id || "Not available"} · {new Date(attempt.created_at).toLocaleString("en-KE")}</small>
                  <label>Safaricom receipt number</label><input value={value.receipt} onChange={e=>update(attempt.id,{receipt:e.target.value.toUpperCase()})} placeholder="e.g. QAB12XYZ34"/>
                  <label>Amount confirmed in Safaricom statement (KES)</label><input type="number" min="0" step="0.01" value={value.amountKes} onChange={e=>update(attempt.id,{amountKes:e.target.value})} placeholder={(Number(attempt.amount_minor)/100).toFixed(2)}/>
                  <label>Verified phone number</label><input value={value.phone} onChange={e=>update(attempt.id,{phone:e.target.value})} placeholder={attempt.customer_phone}/>
                  <label>Reconciliation evidence / reason</label><textarea value={value.reason} onChange={e=>update(attempt.id,{reason:e.target.value})} rows={2} placeholder="Reference the Safaricom statement or query result"/>
                  <div className="button-row"><button className="button button-dark" disabled={busy===attempt.id || !value.receipt || !value.phone || !value.amountKes || value.reason.trim().length<12} onClick={()=>void reconcile(attempt,"mark_paid")}>{busy===attempt.id?"Saving…":"Confirm payment"}</button><button className="button button-light" disabled={busy===attempt.id || value.reason.trim().length<12} onClick={()=>void reconcile(attempt,"mark_failed")}>Mark failed</button></div>
                </div>
              </article>;
            })}
          </div>}
        </section>
        <p className="billing-note">Confirming payment records a verified receipt and updates the order or subscription. Do not use this workflow without checking the provider statement.</p>
        <footer className="dashboard-footer">Signed in as {email} · Reconciliation decisions are permanently audited.</footer>
      </div>
    </section>
  </main>;
}
