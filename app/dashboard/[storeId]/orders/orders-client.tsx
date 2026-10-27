"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowLeft, ClipboardList, Store } from "lucide-react";

type Order = { id:string; order_number:string|number; customer_name:string; customer_email:string|null; customer_phone:string; delivery_address:{address?:string}; status:string; payment_status:string; payment_method:string; currency:string; subtotal_minor:string|number; delivery_fee_minor:string|number; total_minor:string|number; created_at:string };
const nextStatus: Record<string,string[]> = {pending:["confirmed","cancelled"],confirmed:["processing","cancelled"],processing:["ready","shipped","cancelled"],ready:["shipped","completed","cancelled"],shipped:["completed"],completed:[],cancelled:[]};
export default function OrdersClient({storeId,userName}:{storeId:string;userName:string}) {
  const [orders,setOrders]=useState<Order[]>([]);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState("");
  const [store,setStore]=useState<{name:string;slug:string}|null>(null);
  const [busyId,setBusyId]=useState("");
  const [mpesaBusyId,setMpesaBusyId]=useState("");
  const [notice,setNotice]=useState("");
  async function load(){setLoading(true);setError("");try{const [ordersRes,storesRes]=await Promise.all([fetch(`/api/stores/${storeId}/orders`,{cache:"no-store"}),fetch("/api/stores",{cache:"no-store"})]);const od=await ordersRes.json();const sd=await storesRes.json();if(!ordersRes.ok)throw new Error(od.error||"Could not load orders");setOrders(od.orders||[]);setStore((sd.stores||[]).find((s:{id:string})=>s.id===storeId)||null);}catch(e){setError(e instanceof Error?e.message:"Could not load orders");}finally{setLoading(false);}}
  useEffect(()=>{void load();},[storeId]);
  async function updateStatus(order:Order,status:string){setBusyId(order.id);setError("");try{const response=await fetch(`/api/stores/${storeId}/orders/${order.id}`,{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({status})});const data=await response.json();if(!response.ok)throw new Error(data.error||"Could not update order");setOrders(current=>current.map(o=>o.id===order.id?{...o,status:data.order.status}:o));}catch(e){setError(e instanceof Error?e.message:"Could not update order");}finally{setBusyId("");}}
  async function requestMpesa(order:Order) {
    setMpesaBusyId(order.id);setError("");setNotice("");
    try {
      const response=await fetch(`/api/stores/${storeId}/orders/${order.id}/mpesa`,{method:"POST"});
      const data=await response.json();
      if(!response.ok)throw new Error(data.error||"Could not send M-Pesa prompt.");
      setNotice(`M-Pesa prompt sent for order #${order.order_number}. The customer must approve it on their phone.`);
      await load();
    } catch(e) {setError(e instanceof Error?e.message:"Could not send M-Pesa prompt.");}
    finally {setMpesaBusyId("");}
  }
  const money=(minor:string|number,currency:string)=>new Intl.NumberFormat("en-KE",{style:"currency",currency:currency||"KES",maximumFractionDigits:2}).format(Number(minor)/100);
  return <main className="dashboard-shell"><aside className="dashboard-sidebar"><Link className="brand" href="/dashboard"><span className="brand-mark"><Store size={18}/></span><span>MobiWave <strong>Commerce</strong></span></Link><div className="sidebar-label">STORE MANAGEMENT</div><Link className="sidebar-link" href="/dashboard"><ArrowLeft size={17}/> All stores</Link><Link className="sidebar-link" href={`/dashboard/${storeId}/products`}><ClipboardList size={17}/> Products</Link><div className="sidebar-link active"><ClipboardList size={17}/> Orders</div><div className="sidebar-bottom"><div className="user-avatar">{userName.slice(0,1).toUpperCase()}</div><div className="user-details"><b>{userName}</b><small>Store owner</small></div></div></aside><section className="dashboard-main"><header className="dashboard-topbar"><div><span className="eyebrow">ORDER MANAGEMENT</span><h1>{store?.name||"Orders"}</h1></div><span className="free-pill">{orders.length} RECENT ORDERS</span></header><div className="dashboard-content"><Link className="back-link" href="/dashboard"><ArrowLeft size={15}/> Back to stores</Link>{error&&<p className="form-error dashboard-error" role="alert">{error}</p>}{notice&&<p className="success-message dashboard-notice" role="status">{notice}</p>}<section className="workspace-panel"><div className="panel-heading"><div><h3>Orders</h3><p>Track fulfilment and update the order status.</p></div><ClipboardList size={20}/></div>{loading?<p className="empty-state">Loading orders…</p>:orders.length===0?<div className="empty-state"><span className="empty-icon"><ClipboardList size={22}/></span><b>No orders yet</b><p>Orders placed through your public storefront will appear here.</p></div>:<div className="orders-table-wrap"><table className="orders-table"><thead><tr><th>ORDER</th><th>CUSTOMER</th><th>TOTAL</th><th>PAYMENT</th><th>STATUS</th><th>UPDATE</th><th>PAYMENT REQUEST</th></tr></thead><tbody>{orders.map(order=><tr key={order.id}><td><b>#{order.order_number}</b><small>{new Date(order.created_at).toLocaleDateString("en-KE")}</small></td><td><b>{order.customer_name}</b><small>{order.customer_phone}</small><small>{order.delivery_address?.address||""}</small></td><td><b>{money(order.total_minor,order.currency)}</b></td><td><span className="table-status">{order.payment_status}</span><small>{order.payment_method.replaceAll("_"," ")}</small></td><td><span className={`order-status-pill status-${order.status}`}>{order.status}</span></td><td><select aria-label={`Update order ${order.order_number}`} disabled={busyId===order.id||nextStatus[order.status]?.length===0} value="" onChange={e=>{if(e.target.value)void updateStatus(order,e.target.value);}}><option value="">{busyId===order.id?"Saving…":"Change status"}</option>{(nextStatus[order.status]||[]).map(s=><option value={s} key={s}>{s}</option>)}</select></td><td>{order.payment_status==="paid"?<span className="table-status">Paid</span>:<button className="status-toggle" disabled={mpesaBusyId===order.id} onClick={()=>void requestMpesa(order)}>{mpesaBusyId===order.id?"Sending…":"Request M-Pesa"}</button>}</td></tr>)}</tbody></table></div>}</section><footer className="dashboard-footer">Payment status is not changed by order fulfilment updates.</footer></div></section></main>;
}
