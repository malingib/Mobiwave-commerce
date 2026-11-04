"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Check, CreditCard, Store } from "lucide-react";

type Billing = {
  id: string; name: string; slug: string; plan_code: string; subscription_status: string;
  current_period_start: string | null; current_period_end: string | null;
};
type Plan = {
  code: string; name: string; description: string; amount_minor: number | string | null;
  currency: string; billing_interval: string; limits: Record<string, number>; features: string[];
};
type Payment = { id: string; plan_code: string; amount_minor: number | string; currency: string; status: string; created_at: string } | null;

export default function BillingClient({ storeId, userName }: { storeId: string; userName: string }) {
  const [billing, setBilling] = useState<Billing | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [latestPayment, setLatestPayment] = useState<Payment>(null);
  const [platformPaymentsEnabled, setPlatformPaymentsEnabled] = useState(false);
  const [phone, setPhone] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const response = await fetch(`/api/stores/${storeId}/billing`, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not load billing");
      setBilling(data.billing);
      setPlans(data.plans || []);
      setPlatformPaymentsEnabled(Boolean(data.platformPaymentsEnabled));
      setLatestPayment(data.latestPayment || null);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not load billing"); }
    finally { setLoading(false); }
  }, [storeId]);
  useEffect(() => { void load(); }, [load]);

  async function requestUpgrade(plan: Plan) {
    setBusy(plan.code); setError(""); setNotice("");
    try {
      const response = await fetch(`/api/stores/${storeId}/billing/mpesa`, {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() },
        body: JSON.stringify({ planCode: plan.code, phone }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not initiate subscription payment");
      setNotice(data.message || "M-Pesa subscription payment request submitted. Approve it on your phone.");
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not initiate subscription payment"); }
    finally { setBusy(""); }
  }

  const renewalDue = Boolean(billing && billing.plan_code !== "free" && billing.current_period_end && new Date(billing.current_period_end).getTime() <= Date.now() + 7 * 24 * 60 * 60 * 1000);

  const money = (minor: number | string | null, currency = "KES") => minor === null
    ? "Pricing being finalized"
    : new Intl.NumberFormat("en-KE", { style: "currency", currency, maximumFractionDigits: 2 }).format(Number(minor) / 100);

  return <main className="dashboard-shell">
    <aside className="dashboard-sidebar">
      <Link className="brand" href="/dashboard"><span className="brand-mark"><Store size={18}/></span><span>MobiWave <strong>Commerce</strong></span></Link>
      <div className="sidebar-label">STORE MANAGEMENT</div>
      <Link className="sidebar-link" href="/dashboard"><ArrowLeft size={17}/> All stores</Link>
      <Link className="sidebar-link" href={`/dashboard/${storeId}/products`}>Products</Link>
      <Link className="sidebar-link" href={`/dashboard/${storeId}/orders`}>Orders</Link>
      <div className="sidebar-link active"><CreditCard size={17}/> Billing</div>
      <div className="sidebar-bottom"><div className="user-avatar">{userName.slice(0, 1).toUpperCase()}</div><div className="user-details"><b>{userName}</b><small>Store owner</small></div></div>
    </aside>
    <section className="dashboard-main">
      <header className="dashboard-topbar"><div><span className="eyebrow">PLAN & BILLING</span><h1>{billing?.name || "Store billing"}</h1></div><span className="free-pill">{(billing?.plan_code || "free").toUpperCase()} PLAN</span></header>
      <div className="dashboard-content">
        <Link className="back-link" href="/dashboard"><ArrowLeft size={15}/> Back to stores</Link>
        {error && <p className="form-error dashboard-error" role="alert">{error}</p>}
        {notice && <p className="success-message dashboard-notice" role="status">{notice}</p>}
        {loading ? <p className="empty-state">Loading plan details…</p> : billing ? <>
          <section className="billing-current">
            <div><span className="eyebrow">CURRENT PLAN</span><h2>{billing.plan_code.charAt(0).toUpperCase() + billing.plan_code.slice(1)}</h2><p>Your subscription is {billing.subscription_status}.</p>
              {billing.current_period_end && <small>Current period ends {new Date(billing.current_period_end).toLocaleDateString("en-KE")}.</small>}
            </div>
            <span className="order-status-pill status-active">{billing.subscription_status}</span>
          </section>
          {platformPaymentsEnabled && <section className="workspace-panel">
            <div className="panel-heading"><div><h3>M-Pesa subscription payment</h3><p>Enter the number that should receive the STK Push.</p></div><CreditCard size={20}/></div>
            <div className="auth-form"><label htmlFor="billing-phone">M-Pesa phone number</label><input id="billing-phone" type="tel" value={phone} onChange={e => setPhone(e.target.value)} placeholder="0712 345 678" autoComplete="tel"/></div>
          </section>}
          {latestPayment && <p className="billing-note">Latest payment: {latestPayment.plan_code} · {money(latestPayment.amount_minor, latestPayment.currency)} · {latestPayment.status.replaceAll("_", " ")}.</p>}
          <div className="billing-plans">
            {plans.map(plan => <article className={`billing-plan ${billing.plan_code === plan.code ? "current" : ""}`} key={plan.code}>
              <div className="billing-plan-head"><div><h3>{plan.name}</h3><p>{plan.description}</p></div>{billing.plan_code === plan.code && <span className="current-plan-label">CURRENT</span>}</div>
              <div className="billing-price">{money(plan.amount_minor, plan.currency)}{plan.amount_minor !== null && <small> / {plan.billing_interval}</small>}</div>
              <ul>{(plan.features || []).map(feature => <li key={feature}><Check size={14}/>{feature}</li>)}</ul>
              {billing.plan_code === plan.code && renewalDue && platformPaymentsEnabled ? <button className="button button-dark" disabled={busy === plan.code || !phone.trim()} onClick={() => void requestUpgrade(plan)}>{busy === plan.code ? "Sending STK Push…" : "Renew with M-Pesa"}</button>
                : billing.plan_code === plan.code ? <button className="button button-secondary" disabled>Current plan</button>
                : plan.code === "free" ? <button className="button button-secondary" disabled>Free plan</button>
                : plan.amount_minor === null ? <button className="button button-light" disabled>Contact MobiWave for pricing</button>
                : platformPaymentsEnabled ? <button className="button button-dark" disabled={busy === plan.code || !phone.trim()} onClick={() => void requestUpgrade(plan)}>{busy === plan.code ? "Sending STK Push…" : "Pay with M-Pesa"}</button>
                : <button className="button button-light" disabled>Online payments unavailable</button>}
            </article>)}
          </div>
          <p className="billing-note">Prices and quotas are configured by MobiWave. A paid plan becomes active only after a verified Daraja callback; a browser redirect or STK request alone never activates a subscription.</p>
        </> : null}
        <footer className="dashboard-footer">MobiWave Commerce · Billing and plan management</footer>
      </div>
    </section>
  </main>;
}
