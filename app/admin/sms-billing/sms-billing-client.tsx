"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowLeft, CheckCircle2, MessageSquare, Save, ShieldCheck, Store, Wallet } from "lucide-react";

type StoreBilling = {
  store_id:string; name:string; slug:string;
  included_segments_per_month:number|string|null; unit_rate_minor:number|string|null;
  currency:string|null; enabled:boolean|null; updated_at:string|null;
  available_balance_minor:number|string|null; wallet_status:string|null;
  monthly_segments:number|string; monthly_amount_minor:number|string;
};

export default function SmsBillingClient({email}:{email:string}) {
  const [stores,setStores]=useState<StoreBilling[]>([]);
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState("");
  const [error,setError]=useState("");
  const [notice,setNotice]=useState("");

  useEffect(()=>{
    let active=true;
    fetch("/api/admin/sms-billing",{cache:"no-store"})
      .then(async response=>{const data=await response.json();if(!response.ok)throw new Error(data.error||"Could not load SMS billing");if(active)setStores(data.stores||[]);})
      .catch(e=>{if(active)setError(e instanceof Error?e.message:"Could not load SMS billing");})
      .finally(()=>{if(active)setLoading(false);});
    return ()=>{active=false;};
  },[]);

  function patch(storeId:string,change:Partial<StoreBilling>){
    setStores(current=>current.map(store=>store.store_id===storeId?{...store,...change}:store));
  }
  async function save(store:StoreBilling){
    setBusy(store.store_id);setError("");setNotice("");
    try{
      const response=await fetch("/api/admin/sms-billing",{method:"PUT",headers:{"content-type":"application/json"},body:JSON.stringify({
        storeId:store.store_id,
        includedSegmentsPerMonth:Number(store.included_segments_per_month??0),
        unitRateMinor:Math.round(Number(store.unit_rate_minor??0)),
        currency:store.currency||"KES",
        enabled:Boolean(store.enabled),
      })});
      const data=await response.json();
      if(!response.ok)throw new Error(data.error||"Could not save SMS billing");
      setNotice(`SMS billing settings saved for ${store.name}.`);
      setStores(current=>current.map(row=>row.store_id===store.store_id?{...row,...data.config}:row));
    }catch(e){setError(e instanceof Error?e.message:"Could not save SMS billing");}
    finally{setBusy("");}
  }
  const money=(minor:string|number|null,currency="KES")=>new Intl.NumberFormat("en-KE",{style:"currency",currency,maximumFractionDigits:2}).format(Number(minor||0)/100);

  return <main className="dashboard-shell">
    <aside className="dashboard-sidebar">
      <Link className="brand" href="/"><span className="brand-mark"><Store size={18}/></span><span>MobiWave <strong>Commerce</strong></span></Link>
      <div className="sidebar-label">PLATFORM</div>
      <Link className="sidebar-link" href="/admin"><ShieldCheck size={17}/> Superadmin</Link>
      <Link className="sidebar-link" href="/admin/plans">Subscription plans</Link>
      <div className="sidebar-link active"><MessageSquare size={17}/> SMS billing</div>
      <Link className="sidebar-link" href="/admin/domains">Custom domains</Link>
      <Link className="sidebar-link" href="/admin/reconciliation">Payment reconciliation</Link>
      <Link className="sidebar-link" href="/dashboard"><ArrowLeft size={17}/> Merchant dashboard</Link>
      <div className="sidebar-bottom"><div className="user-avatar">A</div><div className="user-details"><b>Platform admin</b><small>{email}</small></div></div>
    </aside>
    <section className="dashboard-main">
      <header className="dashboard-topbar"><div><span className="eyebrow">PLATFORM CONTROL</span><h1>SMS billing</h1></div><span className="free-pill">{stores.length} STORES</span></header>
      <div className="dashboard-content">
        <Link className="back-link" href="/admin"><ArrowLeft size={15}/> Back to superadmin</Link>
        {error&&<p className="form-error dashboard-error" role="alert">{error}</p>}
        {notice&&<p className="success-message dashboard-notice" role="status">{notice}</p>}
        <section className="workspace-panel">
          <div className="panel-heading"><div><h3>Per-store SMS allowance and overage</h3><p>Configure the monthly included segment allowance and wallet-funded rate. Disabled or unconfigured stores cannot send Commerce SMS.</p></div><MessageSquare size={20}/></div>
          {loading?<p className="empty-state">Loading SMS billing…</p>:stores.length===0?<p className="empty-state">No stores have been created yet.</p>:<div className="admin-store-list">
            {stores.map(store=><article className="admin-store-row" key={store.store_id} style={{alignItems:"flex-start"}}>
              <div className="store-avatar"><Store size={18}/></div>
              <div className="admin-store-info" style={{minWidth:220,flex:1}}>
                <b>{store.name}</b><small>{store.slug}.shop.mobiwave.co.ke</small>
                <div className="admin-metrics" style={{margin:"12px 0"}}>
                  <article><span>Used this month</span><b>{Number(store.monthly_segments).toLocaleString("en-KE")} segments</b></article>
                  <article><span>Wallet balance</span><b>{store.available_balance_minor===null?"Not set up":money(store.available_balance_minor,store.currency||"KES")}</b></article>
                </div>
                <label>Included segments per month</label>
                <input type="number" min="0" step="1" value={store.included_segments_per_month??0} onChange={e=>patch(store.store_id,{included_segments_per_month:e.target.value===""?0:Number(e.target.value)})}/>
                <label>Overage rate (KES per segment)</label>
                <input type="number" min="0" step="0.01" value={(Number(store.unit_rate_minor??0)/100).toFixed(2)} onChange={e=>patch(store.store_id,{unit_rate_minor:e.target.value===""?0:Math.round(Number(e.target.value)*100)})}/>
                <label className="checkbox-label"><input type="checkbox" checked={Boolean(store.enabled)} onChange={e=>patch(store.store_id,{enabled:e.target.checked})}/> Enable SMS billing for this store</label>
                <p className="billing-note">Wallet state: {store.wallet_status||"not configured"} · This month’s SMS charges: {money(store.monthly_amount_minor,store.currency||"KES")}</p>
                <button className="button button-dark" disabled={busy===store.store_id} onClick={()=>void save(store)}>{busy===store.store_id?"Saving…":"Save billing settings"} <Save size={15}/></button>
              </div>
            </article>)}
          </div>}
        </section>
        <p className="billing-note">Rates are stored in integer minor units. The worker reserves wallet funds before sending, blocks overage when funds are insufficient, and retains reservations for ambiguous delivery outcomes.</p>
        <footer className="dashboard-footer">Signed in as {email} · Changes are recorded in the platform audit log.</footer>
      </div>
    </section>
  </main>;
}
