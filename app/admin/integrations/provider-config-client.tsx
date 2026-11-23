"use client";

import { useEffect, useState } from "react";

type Provider = { provider:string; status:"not_configured"|"configured"|"verified"|"error"; last_verified_at:string|null; last_error_code:string|null; credentials_saved:boolean; updated_at:string; version:number };
const definitions = [
  {id:"meta",title:"Meta · WhatsApp and Instagram",fields:[["appId","Meta App ID"],["appSecret","Meta App Secret"],["whatsappConfigId","WhatsApp Embedded Signup Config ID"],["graphVersion","Graph API version"],["instagramRedirectUri","Instagram OAuth redirect URI"]]},
  {id:"mobiwave_sms",title:"MobiWave SMS",fields:[["apiUrl","SMS API base URL"],["apiKey","SMS API key"],["senderId","Sender ID"]]},
  {id:"r2",title:"Cloudflare R2 media storage",fields:[["accountId","Cloudflare account ID"],["endpoint","R2 S3 endpoint"],["bucketName","Bucket name"],["accessKeyId","R2 access key ID"],["secretAccessKey","R2 secret access key"]]},
  {id:"media_scanner",title:"Media malware scanner",fields:[["provider","Scanner provider"],["scannerUrl","Scanner base URL"],["scannerToken","Scanner API token"]]},
] as const;

export default function ProviderConfigClient(){
  const [rows,setRows]=useState<Provider[]>([]);
  const [values,setValues]=useState<Record<string,Record<string,string>>>({});
  const [busy,setBusy]=useState("");
  const [notice,setNotice]=useState("");
  const [error,setError]=useState("");
  async function load(){const r=await fetch("/api/admin/provider-config",{cache:"no-store"});const d=await r.json();if(!r.ok)throw new Error(d.error||"Could not load integrations");setRows(d.providers||[]);}
  useEffect(()=>{let active=true;fetch("/api/admin/provider-config",{cache:"no-store"}).then(async r=>{const d=await r.json();if(!r.ok)throw new Error(d.error||"Could not load integrations");if(active)setRows(d.providers||[]);}).catch(e=>{if(active)setError(e.message||"Could not load integrations");});return()=>{active=false};},[]);
  function set(provider:string,key:string,value:string){setValues(current=>({...current,[provider]:{...current[provider],[key]:value}}));}
  async function save(provider:string){setBusy(provider);setError("");setNotice("");try{const config=values[provider]||{};const r=await fetch("/api/admin/provider-config",{method:"PUT",headers:{"content-type":"application/json"},body:JSON.stringify({provider,config})});const d=await r.json();if(!r.ok)throw new Error(d.error||"Save failed");setValues(current=>({...current,[provider]:{}}));await load();setNotice("Credentials encrypted and saved. Secret fields are not returned by the server.");}catch(e){setError(e instanceof Error?e.message:"Save failed");}finally{setBusy("");}}
  async function test(provider:string){setBusy(provider+":test");setError("");setNotice("");try{const r=await fetch("/api/admin/provider-config/test",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({provider})});const d=await r.json();if(!r.ok)throw new Error(d.error||d.status||"Provider verification failed");await load();setNotice(d.message||"Provider verified.");}catch(e){setError(e instanceof Error?e.message:"Provider verification failed");await load().catch(()=>undefined);}finally{setBusy("");}}
  const status=(provider:string)=>rows.find(x=>x.provider===provider);
  return <div className="dashboard-content" style={{padding:0}}>
    <div className="dashboard-intro"><div><h2>Application provider credentials</h2><p>Replace credentials at any time. Existing connections remain stored independently from platform app credentials.</p></div></div>
    {error&&<p className="form-error dashboard-error" role="alert">{error}</p>}{notice&&<p role="status" className="store-state">{notice}</p>}
    <div className="admin-store-list">{definitions.map(item=>{const row=status(item.id);return <section className="workspace-panel" key={item.id} style={{marginBottom:18}}>
      <div className="panel-heading"><div><h3>{item.title}</h3><p>{row?.credentials_saved?"Credentials saved · values remain masked and cannot be retrieved.":"Not configured"}</p></div><span className={"order-status-pill status-"+(row?.status||"not_configured")}>{row?.status||"not_configured"}</span></div>
      <div className="auth-form store-form" style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(260px,1fr))",gap:12}}>
        {item.fields.map(([key,label])=><label key={key}>{label}<input type={/secret|token|key/i.test(key)?"password":"text"} autoComplete="off" value={values[item.id]?.[key]||""} onChange={e=>set(item.id,key,e.target.value)} placeholder={row?.credentials_saved?"Enter to replace saved value":"Enter value"} /></label>)}
      </div>
      <div style={{display:"flex",gap:10,flexWrap:"wrap",marginTop:16}}><button className="button button-dark" disabled={busy===item.id} onClick={()=>void save(item.id)}>{busy===item.id?"Saving…":"Save / replace credentials"}</button><button className="button button-light" disabled={busy===item.id+":test"||!row?.credentials_saved} onClick={()=>void test(item.id)}>{busy===item.id+":test"?"Testing…":"Test connection"}</button></div>
      {row?.last_verified_at&&<small>Last verified: {new Date(row.last_verified_at).toLocaleString()}</small>}{row?.last_error_code&&<small>Last error: {row.last_error_code}</small>}
    </section>})}</div>
    <p className="billing-note">The encryption root key, database connection strings, Neon credentials, Vercel tokens and Cloudflare account bootstrap credentials are never stored in or exposed through this page. R2 connection verification currently validates configuration only; signed bucket verification remains pending.</p>
  </div>;
}
