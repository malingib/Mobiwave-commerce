"use client";

import { useEffect, useRef, useState } from "react";

type Connection = {
  id: string;
  channel: "whatsapp" | "instagram";
  display_name: string | null;
  status: string;
  ownership_mode: string;
  asset_owner_type: string;
  connected_at: string | null;
  expires_at: string | null;
};

type SignupData = { wabaId: string; phoneNumberId: string; businessId?: string };
type PendingSignup = {
  state: string;
  code: string | null;
  signup: SignupData | null;
  completing: boolean;
};

declare global {
  interface Window {
    FB?: {
      init: (options: { appId: string; cookie: boolean; xfbml: boolean; version: string }) => void;
      login: (
        callback: (response: { authResponse?: { code?: string } }) => void,
        options: Record<string, unknown>,
      ) => void;
    };
    fbAsyncInit?: () => void;
  }
}

export default function MetaChannelsClient({
  storeId,
  initialConnections,
  appId,
  graphVersion,
}: {
  storeId: string;
  initialConnections: Connection[];
  appId: string;
  graphVersion: string;
}) {
  const [connections, setConnections] = useState(initialConnections);
  const [ownershipMode, setOwnershipMode] = useState<"merchant_owned" | "mobiwave_managed">("merchant_owned");
  const [assetOwnerType, setAssetOwnerType] = useState<"merchant" | "mobiwave">("merchant");
  const [busy, setBusy] = useState<"whatsapp" | "instagram" | null>(null);
  const [notice, setNotice] = useState("");
  const pending = useRef<PendingSignup | null>(null);

  async function finishWhatsAppIfReady() {
    const current = pending.current;
    if (!current || current.completing || !current.code || !current.signup) return;
    current.completing = true;
    setBusy("whatsapp");
    setNotice("Verifying your WhatsApp Business Account and saving its secure connection…");
    try {
      const response = await fetch(`/api/stores/${encodeURIComponent(storeId)}/channels/meta/whatsapp/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          state: current.state,
          code: current.code,
          wabaId: current.signup.wabaId,
          phoneNumberId: current.signup.phoneNumberId,
          businessId: current.signup.businessId,
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "WhatsApp connection failed");
      setNotice("WhatsApp connected successfully.");
      pending.current = null;
      window.location.reload();
    } catch (error) {
      current.completing = false;
      setBusy(null);
      setNotice(error instanceof Error ? error.message : "WhatsApp connection failed. Start again.");
      pending.current = null;
    }
  }

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== "https://www.facebook.com" && event.origin !== "https://web.facebook.com") return;
      let data: unknown = event.data;
      if (typeof data === "string") {
        try { data = JSON.parse(data); } catch { return; }
      }
      if (!data || typeof data !== "object") return;
      const message = data as { type?: string; event?: string; data?: Record<string, unknown> };
      if (message.type !== "WA_EMBEDDED_SIGNUP" || !pending.current) return;
      if (message.event === "CANCEL") {
        pending.current = null;
        setBusy(null);
        setNotice("WhatsApp onboarding was cancelled.");
        return;
      }
      if (message.event === "FINISH" && message.data) {
        const wabaId = String(message.data.waba_id || "");
        const phoneNumberId = String(message.data.phone_number_id || "");
        const businessId = message.data.business_id ? String(message.data.business_id) : undefined;
        if (!/^\d{5,30}$/.test(wabaId) || !/^\d{5,30}$/.test(phoneNumberId)) {
          pending.current = null;
          setBusy(null);
          setNotice("Meta returned incomplete account details. Please start again.");
          return;
        }
        pending.current.signup = { wabaId, phoneNumberId, businessId };
        void finishWhatsAppIfReady();
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  });

  async function connectWhatsApp() {
    setBusy("whatsapp");
    setNotice("Preparing secure WhatsApp onboarding…");
    try {
      const start = await fetch(`/api/stores/${encodeURIComponent(storeId)}/channels/meta/whatsapp/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ownershipMode, assetOwnerType }),
      });
      const config = await start.json();
      if (!start.ok) throw new Error(config.error || "WhatsApp onboarding is not configured");
      if (!window.FB) throw new Error("Meta login is still loading. Refresh and try again.");
      pending.current = { state: config.state, code: null, signup: null, completing: false };
      window.FB.login((response) => {
        const code = response.authResponse?.code;
        if (!code) {
          pending.current = null;
          setBusy(null);
          setNotice("Meta login was cancelled or did not return an authorization code.");
          return;
        }
        if (!pending.current) return;
        pending.current.code = code;
        void finishWhatsAppIfReady();
      }, {
        config_id: config.configId,
        response_type: "code",
        override_default_response_type: true,
        extras: { setup: {} },
      });
      setNotice("Complete the Meta signup window. Keep this page open until the account is verified.");
    } catch (error) {
      pending.current = null;
      setBusy(null);
      setNotice(error instanceof Error ? error.message : "Could not start WhatsApp onboarding.");
    }
  }

  async function connectInstagram() {
    setBusy("instagram");
    setNotice("Preparing secure Instagram authorization…");
    try {
      const response = await fetch(`/api/stores/${encodeURIComponent(storeId)}/channels/meta/instagram/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ownershipMode, assetOwnerType }),
      });
      const result = await response.json();
      if (!response.ok || typeof result.authorizationUrl !== "string") {
        throw new Error(result.error || "Instagram onboarding is not configured");
      }
      window.location.assign(result.authorizationUrl);
    } catch (error) {
      setBusy(null);
      setNotice(error instanceof Error ? error.message : "Could not start Instagram authorization.");
    }
  }

  useEffect(() => {
    if (!appId) return;
    const initialize = () => window.FB?.init({ appId, cookie: true, xfbml: false, version: graphVersion });
    if (window.FB) {
      initialize();
      return;
    }
    window.fbAsyncInit = initialize;
    if (document.getElementById("mobiwave-meta-sdk")) return;
    const script = document.createElement("script");
    script.id = "mobiwave-meta-sdk";
    script.async = true;
    script.defer = true;
    script.crossOrigin = "anonymous";
    script.src = "https://connect.facebook.net/en_US/sdk.js";
    document.head.appendChild(script);
  }, [appId, graphVersion]);

  const connected = (channel: string) => connections.filter(item => item.channel === channel && item.status === "connected");

  return (
    <div className="dashboard-content">
      <div className="dashboard-intro">
        <h2>Connect your customer channels</h2>
        <p>Use official Meta APIs to bring WhatsApp and Instagram conversations into one merchant inbox. Tokens are encrypted server-side and never shown in this dashboard.</p>
      </div>

      <section className="panel" style={{ marginBottom: 18 }}>
        <div className="panel-heading"><div><h2>Connection ownership</h2><p>Choose who manages onboarding and who owns the Meta assets.</p></div></div>
        <div style={{ padding: 18, display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 14 }}>
          <label style={{ display: "grid", gap: 6, fontSize: 11, color: "#647168" }}>
            Onboarding managed by
            <select value={ownershipMode} onChange={event => setOwnershipMode(event.target.value as typeof ownershipMode)}>
              <option value="merchant_owned">Merchant</option>
              <option value="mobiwave_managed">MobiWave</option>
            </select>
          </label>
          <label style={{ display: "grid", gap: 6, fontSize: 11, color: "#647168" }}>
            Meta asset owner
            <select value={assetOwnerType} onChange={event => setAssetOwnerType(event.target.value as typeof assetOwnerType)}>
              <option value="merchant">Merchant business</option>
              <option value="mobiwave">MobiWave business</option>
            </select>
          </label>
        </div>
      </section>

      <div className="billing-plans" style={{ marginBottom: 18 }}>
        <section className="billing-plan">
          <div className="billing-plan-head"><div><h3>WhatsApp Business</h3><p>Connect a WhatsApp Business Account and verify the selected phone number through Meta Embedded Signup.</p></div><span className="current-plan-label">{connected("whatsapp").length} connected</span></div>
          <ul><li>Official WhatsApp Cloud API</li><li>Webhook subscription and inbound message processing</li><li>Secure token storage with no browser exposure</li></ul>
          <button className="button button-dark" disabled={busy !== null} onClick={connectWhatsApp}>{busy === "whatsapp" ? "Connecting…" : "Connect WhatsApp"}</button>
        </section>
        <section className="billing-plan">
          <div className="billing-plan-head"><div><h3>Instagram Messaging</h3><p>Connect an Instagram professional account using Instagram Login. Publishing and comment management are not requested.</p></div><span className="current-plan-label">{connected("instagram").length} connected</span></div>
          <ul><li>Official Instagram API with Instagram Login</li><li>Messaging permission only</li><li>Long-lived token exchange and webhook subscription</li></ul>
          <button className="button button-dark" disabled={busy !== null} onClick={connectInstagram}>{busy === "instagram" ? "Connecting…" : "Connect Instagram"}</button>
        </section>
      </div>

      {notice && <p className="dashboard-notice">{notice}</p>}

      <section className="panel">
        <div className="panel-heading"><div><h2>Connected accounts</h2><p>Connection health and ownership details. Access tokens are never displayed.</p></div></div>
        {connections.length ? <div className="orders-table-wrap"><table className="orders-table">
          <thead><tr><th>CHANNEL</th><th>ACCOUNT</th><th>STATUS</th><th>ONBOARDING</th><th>ASSET OWNER</th><th>CONNECTED</th></tr></thead>
          <tbody>{connections.map(connection => <tr key={connection.id}>
            <td>{connection.channel === "whatsapp" ? "WhatsApp" : "Instagram"}</td>
            <td><b>{connection.display_name || "Business account"}</b><small>{connection.id}</small></td>
            <td><span className={`order-status-pill status-${connection.status === "connected" ? "completed" : "cancelled"}`}>{connection.status.replaceAll("_", " ")}</span></td>
            <td>{connection.ownership_mode === "mobiwave_managed" ? "MobiWave managed" : "Merchant managed"}</td>
            <td>{connection.asset_owner_type === "mobiwave" ? "MobiWave" : "Merchant"}</td>
            <td>{connection.connected_at ? new Date(connection.connected_at).toLocaleDateString() : "—"}</td>
          </tr>)}</tbody>
        </table></div> : <div className="shop-empty"><h3>No channels connected</h3><p>Connect WhatsApp or Instagram to start receiving customer messages.</p></div>}
      </section>
    </div>
  );
}
