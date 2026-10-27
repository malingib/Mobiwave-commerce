"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, CirclePlus, ClipboardList, CreditCard, ExternalLink, LogOut, Package, Store } from "lucide-react";
import { authClient } from "@/lib/auth-client";

type StoreRecord = { id: string; name: string; slug: string; status: string; currency: string; created_at: string };

export default function DashboardClient({ name, email }: { name: string; email: string }) {
  const [stores, setStores] = useState<StoreRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [storeName, setStoreName] = useState("");
  const [storeSlug, setStoreSlug] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function loadStores() {
    setLoading(true);
    try {
      const response = await fetch("/api/stores", { cache: "no-store" });
      const data = await response.json();
      if (response.ok) setStores(data.stores || []);
      else setError(data.error || "Could not load stores.");
    } catch { setError("Unable to connect to the platform."); }
    finally { setLoading(false); }
  }
  useEffect(() => { void loadStores(); }, []);

  async function createStore(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(""); setBusy(true);
    try {
      const response = await fetch("/api/stores", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: storeName, slug: storeSlug || storeName, phone }) });
      const data = await response.json();
      if (!response.ok) { setError(data.error || "Could not create store."); return; }
      setStores(current => [data.store, ...current]); setStoreName(""); setStoreSlug(""); setPhone("");
    } catch { setError("Unable to create store right now."); }
    finally { setBusy(false); }
  }

  return <main className="dashboard-shell"><aside className="dashboard-sidebar"><Link className="brand" href="/"><span className="brand-mark"><Store size={18}/></span><span>MobiWave <strong>Commerce</strong></span></Link><div className="sidebar-label">WORKSPACE</div><a className="sidebar-link active" href="/dashboard"><Store size={17}/> My stores</a><div className="sidebar-bottom"><div className="user-avatar">{name.slice(0,1).toUpperCase()}</div><div className="user-details"><b>{name}</b><small>{email}</small></div><button className="icon-button" aria-label="Sign out" onClick={async()=>{await authClient.signOut();window.location.assign("/");}}><LogOut size={17}/></button></div></aside><section className="dashboard-main"><header className="dashboard-topbar"><div><span className="eyebrow">MERCHANT WORKSPACE</span><h1>Your stores</h1></div><span className="free-pill">FREE PLAN</span></header><div className="dashboard-content"><div className="dashboard-intro"><div><h2>Good to have you here, {name.split(" ")[0]}.</h2><p>Set up your shop, add your products and get ready to take orders.</p></div></div>{error && <p className="form-error dashboard-error" role="alert">{error}</p>}<div className="workspace-grid"><section className="workspace-panel"><div className="panel-heading"><div><h3>Your stores</h3><p>Each store gets its own public address.</p></div><span className="count-badge">{stores.length}</span></div>{loading ? <p className="empty-state">Loading your stores…</p> : stores.length === 0 ? <div className="empty-state"><span className="empty-icon"><Store size={22}/></span><b>Your first shop starts here</b><p>Create a store to unlock product and order management.</p></div> : <div className="store-list">{stores.map(store=><article className="store-row" key={store.id}><span className="store-avatar"><Store size={19}/></span><div className="store-row-info"><b>{store.name}</b><small>{store.slug}.shop.mobiwave.co.ke</small><span className="store-state">{store.status}</span></div><Link className="icon-button" href={`/dashboard/${store.id}/products`} aria-label={`Manage ${store.name} products`}><Package size={16}/></Link><Link className="icon-button" href={`/dashboard/${store.id}/orders`} aria-label={`Manage ${store.name} orders`}><ClipboardList size={16}/></Link><Link className="icon-button" href={`/dashboard/${store.id}/billing`} aria-label={`Billing for ${store.name}`}><CreditCard size={16}/></Link><a className="icon-button" href={`https://${store.slug}.shop.mobiwave.co.ke`} target="_blank" rel="noreferrer" aria-label={`Open ${store.name} storefront`}><ExternalLink size={16}/></a></article>)}</div>}</section><section className="workspace-panel create-store-panel"><div className="panel-heading"><div><h3>Create a store</h3><p>Choose a name and a free store address.</p></div><CirclePlus size={20}/></div><form className="auth-form store-form" onSubmit={createStore}><label htmlFor="store-name">Store name</label><input id="store-name" value={storeName} onChange={e=>{setStoreName(e.target.value);if(!storeSlug) setStoreSlug(e.target.value.toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,""));}} minLength={2} maxLength={100} placeholder="e.g. Amani Home" required/><label htmlFor="store-slug">Free store address</label><div className="slug-input"><input id="store-slug" value={storeSlug} onChange={e=>setStoreSlug(e.target.value)} maxLength={63} required/><span>.shop.mobiwave.co.ke</span></div><label htmlFor="store-phone">Business phone <span>optional</span></label><input id="store-phone" type="tel" value={phone} onChange={e=>setPhone(e.target.value)} placeholder="+254 7xx xxx xxx"/><button className="button button-dark" disabled={busy}>{busy ? "Creating store…" : "Create free store"} <ArrowRight size={16}/></button></form></section></div><section className="next-steps"><div className="next-step-icon"><Package size={19}/></div><div><b>Next up: add your products</b><p>After creating a store, add product names, prices, descriptions and stock quantities.</p></div></section><footer className="dashboard-footer">MobiWave Commerce · Built for Kenyan businesses</footer></div></section></main>;
}
