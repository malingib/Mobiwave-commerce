"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { ArrowLeft, Package, Plus, Store } from "lucide-react";

type Product = { id: string; name: string; slug: string; description: string; sku: string | null; price_minor: number; currency: string; stock_quantity: number | null; status: string };
export default function ProductsClient({ storeId, userName }: { storeId: string; userName: string }) {
  const [products, setProducts] = useState<Product[]>([]);
  const [store, setStore] = useState<{ name: string; slug: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [description, setDescription] = useState("");
  const [price, setPrice] = useState("");
  const [sku, setSku] = useState("");
  const [stock, setStock] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    setLoading(true); setError("");
    try {
      const [productResponse, storeResponse] = await Promise.all([
        fetch(`/api/stores/${storeId}/products`, { cache: "no-store" }),
        fetch("/api/stores", { cache: "no-store" }),
      ]);
      const productData = await productResponse.json();
      const storeData = await storeResponse.json();
      if (!productResponse.ok) throw new Error(productData.error || "Could not load products.");
      setProducts(productData.products || []);
      setStore((storeData.stores || []).find((item: {id:string})=>item.id===storeId) || null);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not load this store."); }
    finally { setLoading(false); }
  }
  useEffect(()=>{void load();},[storeId]);

  async function setProductStatus(product: Product, status: "active" | "draft" | "archived") {
    setError("");
    try {
      const response = await fetch(`/api/stores/${storeId}/products/${product.id}`, { method: "PATCH", headers: {"content-type":"application/json"}, body: JSON.stringify({status}) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not update product.");
      setProducts(current=>current.map(item=>item.id===product.id?{...item,status}:item));
    } catch(e) { setError(e instanceof Error?e.message:"Could not update product."); }
  }

  async function addProduct(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const response = await fetch(`/api/stores/${storeId}/products`, { method:"POST", headers:{"content-type":"application/json"}, body:JSON.stringify({name,slug:slug||name,description,price,sku,stock}) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not save product.");
      setProducts(current=>[data.product,...current]); setName(""); setSlug(""); setDescription(""); setPrice(""); setSku(""); setStock("");
    } catch(e) {setError(e instanceof Error?e.message:"Could not save product.");}
    finally {setBusy(false);}
  }

  return <main className="dashboard-shell"><aside className="dashboard-sidebar"><Link className="brand" href="/dashboard"><span className="brand-mark"><Store size={18}/></span><span>MobiWave <strong>Commerce</strong></span></Link><div className="sidebar-label">STORE MANAGEMENT</div><Link className="sidebar-link" href="/dashboard"><ArrowLeft size={17}/> All stores</Link><div className="sidebar-link active"><Package size={17}/> Products</div><div className="sidebar-bottom"><div className="user-avatar">{userName.slice(0,1).toUpperCase()}</div><div className="user-details"><b>{userName}</b><small>Store owner</small></div></div></aside><section className="dashboard-main"><header className="dashboard-topbar"><div><span className="eyebrow">PRODUCT CATALOGUE</span><h1>{store?.name || "Products"}</h1></div><span className="free-pill">{products.length} PRODUCTS</span></header><div className="dashboard-content"><Link className="back-link" href="/dashboard"><ArrowLeft size={15}/> Back to stores</Link>{error&&<p className="form-error dashboard-error" role="alert">{error}</p>}<div className="workspace-grid products-layout"><section className="workspace-panel"><div className="panel-heading"><div><h3>Products</h3><p>Draft products stay hidden from shoppers until published.</p></div><Package size={20}/></div>{loading?<p className="empty-state">Loading products…</p>:products.length===0?<div className="empty-state"><span className="empty-icon"><Package size={22}/></span><b>No products yet</b><p>Add your first product using the form.</p></div>:<div className="product-list">{products.map(product=><article className="product-row" key={product.id}><span className="product-row-icon"><Package size={19}/></span><div className="product-row-info"><b>{product.name}</b><small>{product.sku||product.slug} · {product.stock_quantity===null?"Stock not tracked":`${product.stock_quantity} in stock`}</small></div><div className="product-price"><b>KES {(Number(product.price_minor)/100).toLocaleString("en-KE",{minimumFractionDigits:2,maximumFractionDigits:2})}</b><small>{product.status}</small><button className="status-toggle" onClick={()=>void setProductStatus(product,product.status==="active"?"draft":"active")}>{product.status==="active"?"Unpublish":"Publish"}</button></div></article>)}</div>}</section><section className="workspace-panel"><div className="panel-heading"><div><h3>Add a product</h3><p>Prices are stored in cents to avoid rounding errors.</p></div><Plus size={20}/></div><form className="auth-form store-form" onSubmit={addProduct}><label htmlFor="product-name">Product name</label><input id="product-name" value={name} onChange={e=>{setName(e.target.value);if(!slug)setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,""));}} maxLength={160} required/><label htmlFor="product-slug">Product address</label><input id="product-slug" value={slug} onChange={e=>setSlug(e.target.value)} maxLength={63} required/><label htmlFor="product-price">Price (KES)</label><input id="product-price" type="number" min="0" step="0.01" value={price} onChange={e=>setPrice(e.target.value)} required/><label htmlFor="product-stock">Stock quantity <span>optional</span></label><input id="product-stock" type="number" min="0" step="1" value={stock} onChange={e=>setStock(e.target.value)}/><label htmlFor="product-sku">SKU <span>optional</span></label><input id="product-sku" value={sku} onChange={e=>setSku(e.target.value)} maxLength={100}/><label htmlFor="product-description">Description <span>optional</span></label><textarea id="product-description" value={description} onChange={e=>setDescription(e.target.value)} rows={3} maxLength={5000}/><button className="button button-dark" disabled={busy}>{busy?"Saving…":"Save as draft"} <Plus size={16}/></button></form></section></div><footer className="dashboard-footer">Signed in as {userName} · Product editing and publishing controls are being expanded.</footer></div></section></main>;
}
