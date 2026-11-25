"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { ArrowLeft, CheckCircle2, ClipboardList, Store } from "lucide-react";

type Onboarding = {
  name: string;
  slug: string;
  contact_email: string | null;
  contact_phone: string | null;
  business_category: string;
  business_description: string;
  website_url: string | null;
  launch_status: string;
  risk_flags: string[];
  review_note: string | null;
  active_product_count: number;
};

const categories = [
  ["general_retail","General retail"],["food_beverage","Food and beverage"],["beauty","Beauty and personal care"],
  ["fashion","Fashion"],["electronics","Electronics"],["home_living","Home and living"],
  ["services","Services"],["digital_goods","Digital goods"],["regulated","Regulated products or services"],["other","Other / not listed"],
];

export default function OnboardingClient({ storeId, userName }: { storeId: string; userName: string }) {
  const [data,setData] = useState<Onboarding|null>(null);
  const [emailVerified,setEmailVerified] = useState(false);
  const [canEdit,setCanEdit] = useState(false);
  const [category,setCategory] = useState("general_retail");
  const [description,setDescription] = useState("");
  const [phone,setPhone] = useState("");
  const [website,setWebsite] = useState("");
  const [loading,setLoading] = useState(true);
  const [busy,setBusy] = useState("");
  const [error,setError] = useState("");
  const [notice,setNotice] = useState("");
  const [missing,setMissing] = useState<string[]>([]);

  const load = useCallback(async () => {
    try {
      const response=await fetch(`/api/stores/${storeId}/onboarding`,{cache:"no-store"});
      const result=await response.json();
      if(!response.ok) throw new Error(result.error||"Could not load onboarding details");
      setData(result.onboarding);setEmailVerified(result.email_verified===true);setCanEdit(result.role==="owner");
      setCategory(result.onboarding.business_category||"general_retail");
      setDescription(result.onboarding.business_description||"");
      setPhone(result.onboarding.contact_phone||"");
      setWebsite(result.onboarding.website_url||"");
    } catch(e) {setError(e instanceof Error?e.message:"Could not load onboarding details");}
    finally {setLoading(false);}
  }, [storeId]);
  useEffect(()=>{void load();},[load]);

  async function save(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();setBusy("save");setError("");setNotice("");setMissing([]);
    try {
      const response=await fetch(`/api/stores/${storeId}/onboarding`,{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({businessCategory:category,businessDescription:description,contactPhone:phone,websiteUrl:website})});
      const result=await response.json();
      if(!response.ok) throw new Error(result.error||"Could not save details");
      setNotice(result.message||"Business details saved.");await load();
    } catch(e) {setError(e instanceof Error?e.message:"Could not save details");}
    finally {setBusy("");}
  }

  async function submitLaunch() {
    setBusy("launch");setError("");setNotice("");setMissing([]);
    try {
      const response=await fetch(`/api/stores/${storeId}/launch`,{method:"POST"});
      const result=await response.json();
      if(response.status===409 && Array.isArray(result.missing)){setMissing(result.missing);setError(result.message||"Complete the remaining setup steps.");return;}
      if(!response.ok && response.status!==202) throw new Error(result.error||result.message||"Could not submit store");
      setNotice(result.message||"Launch request submitted.");await load();
    } catch(e) {setError(e instanceof Error?e.message:"Could not submit store");}
    finally {setBusy("");}
  }

  const locked=data?.launch_status==="pending_review"||data?.launch_status==="auto_approved"||data?.launch_status==="approved";
  return <main className="dashboard-shell">
    <aside className="dashboard-sidebar">
      <Link className="brand" href="/dashboard"><span className="brand-mark"><Store size={18}/></span><span>MobiWave <strong>Commerce</strong></span></Link>
      <div className="sidebar-label">STORE SETUP</div>
      <Link className="sidebar-link" href="/dashboard"><ArrowLeft size={17}/> All stores</Link>
      <div className="sidebar-link active"><ClipboardList size={17}/> Launch checklist</div>
      <div className="sidebar-bottom"><div className="user-avatar">{userName.slice(0,1).toUpperCase()}</div><div className="user-details"><b>{userName}</b><small>Store owner</small></div></div>
    </aside>
    <section className="dashboard-main">
      <header className="dashboard-topbar"><div><span className="eyebrow">MERCHANT ONBOARDING</span><h1>Prepare your store</h1></div><span className="free-pill">{data?.launch_status?.replaceAll("_"," ").toUpperCase()||"SETUP"}</span></header>
      <div className="dashboard-content">
        <Link className="back-link" href="/dashboard"><ArrowLeft size={15}/> Back to stores</Link>
        {error&&<p className="form-error dashboard-error" role="alert">{error}</p>}
        {notice&&<p className="success-message dashboard-notice" role="status">{notice}</p>}
        {loading?<p className="empty-state">Loading your setup…</p>:data&&<>
          <section className="workspace-panel">
            <div className="panel-heading"><div><h3>{data.name}</h3><p>{data.slug}.shop.mobiwave.co.ke · Store remains private until launch approval.</p></div><Store size={20}/></div>
            <form className="auth-form store-form" onSubmit={save}>
              <label htmlFor="business-category">Business category</label>
              <select id="business-category" value={category} onChange={e=>setCategory(e.target.value)} disabled={locked||!canEdit}>
                {categories.map(([value,label])=><option key={value} value={value}>{label}</option>)}
              </select>
              <label htmlFor="business-description">What does your business sell or provide?</label>
              <textarea id="business-description" value={description} onChange={e=>setDescription(e.target.value)} minLength={30} maxLength={2000} rows={5} placeholder="Describe your products or services, who you serve and where you operate." disabled={locked} required/>
              <label htmlFor="business-phone">Business phone</label>
              <input id="business-phone" type="tel" value={phone} onChange={e=>setPhone(e.target.value)} placeholder="+254 7xx xxx xxx" disabled={locked} required/>
              <label htmlFor="business-website">Website <span>optional</span></label>
              <input id="business-website" type="url" value={website} onChange={e=>setWebsite(e.target.value)} placeholder="https://example.com" disabled={locked}/>
              <p className="billing-note">Account email: {data.contact_email||"Not set"} · {emailVerified?"Verified":"Email verification required before launch"}</p>
              {!locked&&canEdit&&<button className="button button-dark" disabled={busy==="save"}>{busy==="save"?"Saving…":"Save business details"}</button>}
            </form>
          </section>
          <section className="workspace-panel">
            <div className="panel-heading"><div><h3>Launch requirements</h3><p>Stores launch automatically when all checks pass and no review flags are raised.</p></div><CheckCircle2 size={20}/></div>
            <ul className="launch-checklist">
              <li>{emailVerified?"✓":"○"} Verified account email</li>
              <li>{phone?"✓":"○"} Valid Kenyan business phone</li>
              <li>{description.trim().length>=30?"✓":"○"} Business description (at least 30 characters)</li>
              <li>{Number(data.active_product_count)>0?"✓":"○"} At least one published product</li>
            </ul>
            {missing.length>0&&<div className="form-error"><b>Still required</b><ul>{missing.map(item=><li key={item}>{item}</li>)}</ul></div>}
            {data.launch_status==="pending_review"&&<p className="billing-note">Your store is awaiting platform review. It will remain private until approved.</p>}{!canEdit&&<p className="billing-note">Only the store owner can edit onboarding details or submit this store for launch.</p>}
            {data.launch_status==="rejected"&&<p className="form-error">Review note: {data.review_note||"Please contact MobiWave support."} Save updated details and resubmit when ready.</p>}
            {(data.launch_status==="auto_approved"||data.launch_status==="approved")&&<p className="success-message">Your store is live.</p>}
            {!locked&&canEdit&&<div className="form-actions"><Link className="button button-light" href={`/dashboard/${storeId}/products`}>Manage products</Link><button className="button button-dark" disabled={busy==="launch"} onClick={()=>void submitLaunch()}>{busy==="launch"?"Checking…":"Submit for launch"}</button></div>}
          </section>
        </>}
        <footer className="dashboard-footer">MobiWave Commerce · Stores stay private until launch checks pass.</footer>
      </div>
    </section>
  </main>;
}
