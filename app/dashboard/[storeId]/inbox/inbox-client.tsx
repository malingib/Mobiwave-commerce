"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Check, CheckCheck, Clock3, Instagram, MessageCircle,
  RefreshCw, Search, Send, Store, UserRound, AlertCircle,
} from "lucide-react";

type Conversation = {
  id: string; connection_id: string; channel: "whatsapp" | "instagram" | "website" | "email" | "sms";
  status: "open" | "pending" | "resolved" | "archived"; priority: "low" | "normal" | "high" | "urgent";
  unread_count: number; assigned_to: string | null; customer_name: string | null;
  phone_e164: string | null; external_user_id: string; channel_name: string | null;
  last_message: string | null; last_direction: string | null; last_provider_status: string | null;
  last_message_at: string | null; last_message_created_at: string | null;
};
type Message = {
  id: string; direction: "inbound" | "outbound" | "system"; message_type: string;
  content: string | null; provider_status: string; provider_error_code: string | null;
  provider_timestamp: string | null; sent_at: string | null; delivered_at: string | null;
  read_at: string | null; sender_user_id: string | null; created_at: string;
};
type Note = { id: string; author_user_id: string; body: string; created_at: string };
type ApprovedTemplate = { id: string; name: string; language: string; category: string | null; bodyText: string; parameterCount: number };
type Detail = {
  conversation: Conversation & { email: string | null; connection_status: string; created_at: string; last_inbound_at: string | null; reply_window_open: boolean };
  messages: Message[]; notes: Note[];
};

function timeLabel(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-KE", { hour: "2-digit", minute: "2-digit", day: "numeric", month: "short" }).format(date);
}
function channelLabel(channel: string) {
  if (channel === "whatsapp") return "WhatsApp";
  if (channel === "instagram") return "Instagram";
  return channel;
}
function statusLabel(status: string) {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

export default function InboxClient({ storeId, userId, userName }: { storeId: string; userId: string; userName: string }) {
  const [conversations,setConversations] = useState<Conversation[]>([]);
  const [selectedId,setSelectedId] = useState("");
  const [detail,setDetail] = useState<Detail | null>(null);
  const [status,setStatus] = useState("all");
  const [channel,setChannel] = useState("all");
  const [search,setSearch] = useState("");
  const [draft,setDraft] = useState("");
  const [noteDraft,setNoteDraft] = useState("");
  const [replyMode,setReplyMode] = useState<"text"|"template">("text");
  const [templates,setTemplates] = useState<ApprovedTemplate[]>([]);
  const [templatesLoading,setTemplatesLoading] = useState(false);
  const [selectedTemplateKey,setSelectedTemplateKey] = useState("");
  const [templateParams,setTemplateParams] = useState<string[]>([]);
  const [loading,setLoading] = useState(true);
  const [detailLoading,setDetailLoading] = useState(true);
  const [sending,setSending] = useState(false);
  const [saving,setSaving] = useState(false);
  const [addingNote,setAddingNote] = useState(false);
  const [error,setError] = useState("");
  const [notice,setNotice] = useState("");

  const loadConversations = useCallback(async () => {
    try {
      const params = new URLSearchParams({ status, channel });
      const response = await fetch("/api/stores/" + storeId + "/conversations?" + params.toString(), { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not load inbox");
      const rows = (data.conversations || []) as Conversation[];
      setConversations(rows);
      setSelectedId(current => current && rows.some(row => row.id === current) ? current : rows[0]?.id || "");
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load inbox");
    } finally { setLoading(false); }
  }, [storeId,status,channel]);

  const loadDetail = useCallback(async (id: string) => {
    if (!id) { setDetail(null); return; }
    setDetailLoading(true);
    try {
      const response = await fetch("/api/stores/" + storeId + "/conversations/" + id, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not load conversation");
      setDetail(data as Detail);
      if (Number(data.conversation?.unread_count || 0) > 0) {
        await fetch("/api/stores/" + storeId + "/conversations/" + id, {
          method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ markRead: true }),
        });
        setDetail(current => current ? { ...current, conversation: { ...current.conversation, unread_count: 0 } } : current);
        setConversations(current => current.map(row => row.id === id ? { ...row, unread_count: 0 } : row));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load conversation");
    } finally { setDetailLoading(false); }
  }, [storeId]);

  useEffect(() => {
    let active = true;
    const run = async () => {
      try {
        const params = new URLSearchParams({ status, channel });
        const response = await fetch("/api/stores/" + storeId + "/conversations?" + params.toString(), { cache: "no-store" });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Could not load inbox");
        if (active) {
          const rows = (data.conversations || []) as Conversation[];
          setConversations(rows);
          setSelectedId(current => current && rows.some(row => row.id === current) ? current : rows[0]?.id || "");
          setError("");
        }
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : "Could not load inbox");
      } finally {
        if (active) setLoading(false);
      }
    };
    void run();
    return () => { active = false; };
  }, [storeId,status,channel]);

  useEffect(() => {
    if (!selectedId) return;
    let active = true;
    const run = async () => {
      try {
        const response = await fetch("/api/stores/" + storeId + "/conversations/" + selectedId, { cache: "no-store" });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Could not load conversation");
        if (active) setDetail(data as Detail);
        if (Number(data.conversation?.unread_count || 0) > 0) {
          await fetch("/api/stores/" + storeId + "/conversations/" + selectedId, {
            method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ markRead: true }),
          });
          if (active) {
            setDetail(current => current ? { ...current, conversation: { ...current.conversation, unread_count: 0 } } : current);
            setConversations(current => current.map(row => row.id === selectedId ? { ...row, unread_count: 0 } : row));
          }
        }
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : "Could not load conversation");
      } finally {
        if (active) setDetailLoading(false);
      }
    };
    void run();
    return () => { active = false; };
  }, [storeId,selectedId]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      void loadConversations();
      if (selectedId) void loadDetail(selectedId);
    }, 20_000);
    return () => window.clearInterval(interval);
  }, [loadConversations,loadDetail,selectedId]);

  const loadTemplates = useCallback(async (connectionId: string) => {
    setTemplatesLoading(true); setTemplates([]); setSelectedTemplateKey(""); setTemplateParams([]); setError("");
    try {
      const response = await fetch("/api/stores/" + storeId + "/channels/" + connectionId + "/templates", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not load approved templates");
      const rows = (data.templates || []) as ApprovedTemplate[];
      setTemplates(rows);
      if (rows[0]) {
        setSelectedTemplateKey(rows[0].name + "::" + rows[0].language);
        setTemplateParams(Array.from({ length: rows[0].parameterCount }, () => ""));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load approved templates");
    } finally { setTemplatesLoading(false); }
  }, [storeId]);

  const visible = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return conversations;
    return conversations.filter(row =>
      [row.customer_name,row.phone_e164,row.external_user_id,row.last_message,channelLabel(row.channel)]
        .some(value => String(value || "").toLowerCase().includes(query)),
    );
  }, [conversations,search]);

  async function updateConversation(values: Record<string,unknown>) {
    if (!selectedId) return;
    setSaving(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/stores/" + storeId + "/conversations/" + selectedId, {
        method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(values),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not update conversation");
      setDetail(current => current ? { ...current, conversation: { ...current.conversation, ...data.conversation } } : current);
      await loadConversations();
      setNotice("Conversation updated.");
    } catch (e) { setError(e instanceof Error ? e.message : "Could not update conversation"); }
    finally { setSaving(false); }
  }

  async function sendReply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const useTemplate = replyMode === "template";
    if (!selectedId || (useTemplate ? !canSendTemplate : !draft.trim())) return;
    setSending(true); setError(""); setNotice("");
    try {
      const payload = useTemplate && selectedTemplate
        ? { type: "template", templateName: selectedTemplate.name, language: selectedTemplate.language, parameters: templateParams }
        : { type: "text", text: draft.trim() };
      const response = await fetch("/api/stores/" + storeId + "/conversations/" + selectedId + "/messages", {
        method: "POST",
        headers: { "content-type": "application/json", "Idempotency-Key": window.crypto.randomUUID() },
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Message could not be queued");
      setDraft("");
      if (useTemplate && selectedTemplate) setTemplateParams(Array.from({ length: selectedTemplate.parameterCount }, () => ""));
      setNotice("Reply queued. Delivery will update when Meta confirms the message.");
      await Promise.all([loadDetail(selectedId),loadConversations()]);
    } catch (e) { setError(e instanceof Error ? e.message : "Message could not be queued"); }
    finally { setSending(false); }
  }

  async function addNote(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedId || !noteDraft.trim()) return;
    setAddingNote(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/stores/" + storeId + "/conversations/" + selectedId + "/notes", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ body: noteDraft.trim() }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not save note");
      setNoteDraft("");
      setDetail(current => current ? { ...current, notes: [data.note,...current.notes] } : current);
      setNotice("Internal note saved.");
    } catch (e) { setError(e instanceof Error ? e.message : "Could not save note"); }
    finally { setAddingNote(false); }
  }

  const conversation = detail?.conversation;
  const canReply = Boolean(conversation && ["whatsapp","instagram"].includes(conversation.channel) && conversation.connection_status === "connected" && conversation.reply_window_open);
  const selectedTemplate = templates.find(template => template.name + "::" + template.language === selectedTemplateKey) || null;
  const canSendTemplate = Boolean(conversation?.channel === "whatsapp" && conversation.connection_status === "connected" &&
    selectedTemplate && templateParams.length === selectedTemplate.parameterCount && templateParams.every(value => value.trim().length > 0));

  return (
    <main className="dashboard-shell">
      <aside className="dashboard-sidebar">
        <Link className="brand" href="/dashboard"><span className="brand-mark"><Store size={18}/></span><span>MobiWave <strong>Commerce</strong></span></Link>
        <div className="sidebar-label">STORE MANAGEMENT</div>
        <Link className="sidebar-link" href={"/dashboard/" + storeId + "/products"}>Products</Link>
        <Link className="sidebar-link" href={"/dashboard/" + storeId + "/orders"}>Orders</Link>
        <Link className="sidebar-link active" href={"/dashboard/" + storeId + "/inbox"}><MessageCircle size={17}/> Unified inbox</Link>
        <Link className="sidebar-link" href={"/dashboard/" + storeId + "/integrations/channels"}>Sales channels</Link>
        <Link className="sidebar-link" href={"/dashboard/" + storeId + "/integrations/mpesa"}>M-Pesa integration</Link>
        <div className="sidebar-bottom"><div className="user-avatar">{userName.slice(0,1).toUpperCase()}</div><div className="user-details"><b>{userName}</b><small>Store member</small></div></div>
      </aside>
      <section className="dashboard-main">
        <header className="dashboard-topbar">
          <div><span className="eyebrow">CUSTOMER MESSAGING</span><h1>Unified inbox</h1></div>
          <button className="icon-button" onClick={() => { void loadConversations(); if (selectedId) void loadDetail(selectedId); }} aria-label="Refresh inbox"><RefreshCw size={16}/></button>
        </header>
        <div className="inbox-content">
          <div className="inbox-toolbar">
            <div><h2>Conversations</h2><p>WhatsApp and Instagram messages in one workspace.</p></div>
            <div className="inbox-filters">
              <select value={status} onChange={e=>{setSelectedId("");setDetail(null);setDetailLoading(true);setStatus(e.target.value);}} aria-label="Filter conversation status">
                <option value="all">All statuses</option><option value="open">Open</option><option value="pending">Pending</option><option value="resolved">Resolved</option><option value="archived">Archived</option>
              </select>
              <select value={channel} onChange={e=>{setSelectedId("");setDetail(null);setDetailLoading(true);setChannel(e.target.value);}} aria-label="Filter channel">
                <option value="all">All channels</option><option value="whatsapp">WhatsApp</option><option value="instagram">Instagram</option>
              </select>
            </div>
          </div>
          {error && <p className="form-error dashboard-error" role="alert"><AlertCircle size={15}/> {error}</p>}
          {notice && <p className="success-message dashboard-notice" role="status">{notice}</p>}
          <div className="inbox-workspace">
            <section className="inbox-list-panel" aria-label="Conversation list">
              <div className="inbox-search"><Search size={16}/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search people or messages…" aria-label="Search conversations"/></div>
              <div className="inbox-list-head"><span>{visible.length} CONVERSATIONS</span><button onClick={()=>void loadConversations()} aria-label="Refresh conversations"><RefreshCw size={14}/></button></div>
              <div className="inbox-list-scroll">
                {loading ? <div className="inbox-empty">Loading conversations…</div> : visible.length===0 ? <div className="inbox-empty"><MessageCircle size={24}/><b>No conversations found</b><span>Incoming WhatsApp and Instagram messages will appear here.</span></div> : visible.map(row=>(
                  <button key={row.id} className={"inbox-conversation " + (selectedId===row.id?"selected":"")} onClick={()=>{setDetail(null);setDetailLoading(true);setReplyMode("text");setTemplates([]);setSelectedTemplateKey("");setTemplateParams([]);setDraft("");setSelectedId(row.id);}}>
                    <span className={"channel-avatar " + row.channel}>{row.channel==="instagram"?<Instagram size={17}/>:<MessageCircle size={17}/>}</span>
                    <span className="inbox-row-main">
                      <span className="inbox-row-top"><b>{row.customer_name || row.phone_e164 || row.external_user_id}</b><time>{timeLabel(row.last_message_at || row.last_message_created_at)}</time></span>
                      <span className="inbox-row-preview">{row.last_direction==="outbound"?"You: ":""}{row.last_message || "No message text"}</span>
                      <span className="inbox-row-bottom"><small>{channelLabel(row.channel)}</small><small className={"inbox-status status-" + row.status}>{statusLabel(row.status)}</small></span>
                    </span>
                    {row.unread_count>0&&<span className="unread-count">{row.unread_count>99?"99+":row.unread_count}</span>}
                  </button>
                ))}
              </div>
            </section>
            <section className="inbox-detail-panel" aria-label="Conversation detail">
              {!selectedId ? <div className="inbox-detail-empty"><MessageCircle size={32}/><b>Select a conversation</b><p>Choose a customer conversation to view its history and reply.</p></div> :
                detailLoading && !detail ? <div className="inbox-detail-empty">Loading conversation…</div> :
                !detail ? <div className="inbox-detail-empty">{detailLoading?"Loading conversation…":"Conversation unavailable."}</div> :
                <>
                  <div className="conversation-header">
                    <div className="conversation-person">
                      <span className={"channel-avatar large " + conversation?.channel}>{conversation?.channel==="instagram"?<Instagram size={19}/>:<MessageCircle size={19}/>}</span>
                      <div><b>{conversation?.customer_name || conversation?.phone_e164 || conversation?.external_user_id}</b><small>{channelLabel(conversation?.channel || "")} · {conversation?.phone_e164 || conversation?.email || conversation?.external_user_id}</small></div>
                    </div>
                    <div className="conversation-actions">
                      <select aria-label="Conversation status" value={conversation?.status || "open"} disabled={saving} onChange={e=>void updateConversation({status:e.target.value})}>
                        <option value="open">Open</option><option value="pending">Pending</option><option value="resolved">Resolved</option><option value="archived">Archived</option>
                      </select>
                      <select aria-label="Conversation priority" value={conversation?.priority || "normal"} disabled={saving} onChange={e=>void updateConversation({priority:e.target.value})}>
                        <option value="low">Low priority</option><option value="normal">Normal</option><option value="high">High</option><option value="urgent">Urgent</option>
                      </select>
                    </div>
                  </div>
                  <div className="conversation-subbar">
                    <span><UserRound size={14}/>{conversation?.assigned_to===userId?"Assigned to you":conversation?.assigned_to?"Assigned to teammate":"Unassigned"}</span>
                    <button disabled={saving} onClick={()=>void updateConversation({assignedTo:conversation?.assigned_to===userId?null:userId})}>{conversation?.assigned_to===userId?"Unassign me":"Assign to me"}</button>
                    <span className="connection-state"><i className={conversation?.connection_status==="connected"?"online":""}/>{conversation?.connection_status==="connected"?"Channel connected":"Channel disconnected"}</span>
                  </div>
                  <div className="conversation-timeline">
                    {detail.messages.length===0?<div className="inbox-detail-empty">No messages in this conversation yet.</div>:detail.messages.map(message=>(
                      <div key={message.id} className={"message-row " + (message.direction==="outbound"?"outbound":message.direction==="system"?"system":"inbound")}>
                        <div className="message-bubble">
                          {message.content ? <p>{message.content}</p> : <p className="muted-message">{message.message_type==="image"?"Image attachment":message.message_type==="video"?"Video attachment":message.message_type==="audio"?"Audio attachment":message.message_type==="document"?"Document attachment":"Unsupported message content"}</p>}
                          <span className="message-meta">{timeLabel(message.created_at)} {message.direction==="outbound"&&<><span>{message.provider_status==="failed"?"Failed":message.provider_status==="read"?"Read":message.provider_status==="delivered"?"Delivered":message.provider_status==="sent"?"Sent":message.provider_status==="queued"?"Queued":"Sending"}</span>{message.provider_status==="read"?<CheckCheck size={13}/>:message.provider_status==="delivered"?<CheckCheck size={13}/>:<Check size={13}/>}</>}</span>
                          {message.provider_error_code&&<small className="message-error">{message.provider_error_code}</small>}
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="inbox-lower-panels">
                    <section className="internal-notes">
                      <div className="inbox-section-heading"><b>Internal notes</b><span>Visible to your team only</span></div>
                      <div className="notes-list">{detail.notes.length===0?<p className="notes-empty">No internal notes yet.</p>:detail.notes.map(note=><article className="note-item" key={note.id}><p>{note.body}</p><small>{note.author_user_id===userId?"You":"Team member"} · {timeLabel(note.created_at)}</small></article>)}</div>
                      <form className="note-compose" onSubmit={addNote}><input value={noteDraft} onChange={e=>setNoteDraft(e.target.value)} placeholder="Add an internal note…" maxLength={10000}/><button disabled={addingNote||!noteDraft.trim()}>{addingNote?"Saving…":"Add note"}</button></form>
                    </section>
                  </div>
                  <form className="reply-compose" onSubmit={sendReply}>
                    {conversation?.channel==="whatsapp"&&<div className="reply-mode-select"><label htmlFor="reply-mode">Message type</label><select id="reply-mode" value={replyMode} onChange={e=>{const mode=e.target.value as "text"|"template";setReplyMode(mode);if(mode==="template"&&conversation.connection_id)void loadTemplates(conversation.connection_id);}}><option value="text">Free-form text</option><option value="template">Approved template</option></select></div>}
                    {replyMode==="template"&&conversation?.channel==="whatsapp" ? <div className="template-compose">
                      {templatesLoading?<p className="template-empty">Loading approved templates…</p>:templates.length===0?<p className="template-empty">No supported approved templates were returned for this WhatsApp account. Check the account’s WhatsApp Business permissions and template approvals.</p>:<>
                        <label htmlFor="approved-template">Approved WhatsApp template</label>
                        <select id="approved-template" value={selectedTemplateKey} onChange={e=>{const key=e.target.value;const selected=templates.find(item=>item.name+"::"+item.language===key);setSelectedTemplateKey(key);setTemplateParams(Array.from({length:selected?.parameterCount||0},()=> ""));}}>
                          {templates.map(template=><option key={template.name+"::"+template.language} value={template.name+"::"+template.language}>{template.name} · {template.language} · {template.category||"Template"}</option>)}
                        </select>
                        {selectedTemplate&&<div className="template-preview"><span>MESSAGE PREVIEW</span><p>{selectedTemplate.bodyText}</p>{selectedTemplate.parameterCount>0&&<small>Fill {selectedTemplate.parameterCount} text parameter{selectedTemplate.parameterCount===1?"":"s"} below in the order shown.</small>}</div>}
                        {templateParams.map((value,index)=><label className="template-param" key={index}>Parameter {index+1}<input value={value} maxLength={1024} onChange={e=>setTemplateParams(current=>current.map((item,i)=>i===index?e.target.value:item))} placeholder={"Value for {{"+(index+1)+"}}"}/></label>)}
                      </>}
                    </div> : <>
                      {!canReply&&<div className="reply-window-warning"><Clock3 size={14}/>{conversation?.channel==="whatsapp"||conversation?.channel==="instagram"?"Free-form replies are available only within 24 hours of the customer’s last message. Use an approved WhatsApp template to start a new conversation.":"Outbound replies for this channel are not enabled yet."}</div>}
                      <textarea value={draft} onChange={e=>setDraft(e.target.value)} placeholder={canReply?"Write a reply…":"Customer messaging window closed"} maxLength={conversation?.channel==="instagram"?1000:4096} disabled={!canReply||sending}/>
                    </>}
                    <div className="reply-compose-footer"><span>{replyMode==="template"?"Approved WhatsApp template · Outside-window messaging":"Text only · "+(conversation?.channel==="instagram"?"1,000":"4,096")+" character limit"}</span><button className="button button-dark" disabled={sending||(replyMode==="template"?!canSendTemplate:!canReply||!draft.trim())}>{sending?"Queueing…":replyMode==="template"?"Send template":"Send reply"} <Send size={15}/></button></div>
                  </form>
                </>
              }
            </section>
          </div>
        </div>
      </section>
    </main>
  );
}
