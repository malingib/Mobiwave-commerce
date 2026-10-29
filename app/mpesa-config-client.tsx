"use client";

import { FormEvent, useEffect, useState } from "react";

type Config = { shortcode: string; environment: "sandbox" | "production"; transaction_type: "CustomerPayBillOnline" | "CustomerBuyGoodsOnline"; enabled: boolean; credentials_saved: boolean; updated_at?: string } | null;

export default function MpesaConfigClient({ endpoint, title, description }: { endpoint: string; title: string; description: string }) {
  const [config, setConfig] = useState<Config>(null);
  const [consumerKey, setConsumerKey] = useState("");
  const [consumerSecret, setConsumerSecret] = useState("");
  const [shortcode, setShortcode] = useState("");
  const [passkey, setPasskey] = useState("");
  const [environment, setEnvironment] = useState<"sandbox" | "production">("sandbox");
  const [transactionType, setTransactionType] = useState<"CustomerPayBillOnline" | "CustomerBuyGoodsOnline">("CustomerPayBillOnline");
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch(endpoint, { cache: "no-store" });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Could not load configuration");
        if (cancelled) return;
        const saved = data.configuration as Config;
        setConfig(saved);
        if (saved) {
          setShortcode(saved.shortcode || "");
          setEnvironment(saved.environment || "sandbox");
          setTransactionType(saved.transaction_type || "CustomerPayBillOnline");
          setEnabled(Boolean(saved.enabled));
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Could not load configuration");
      } finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [endpoint]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(""); setNotice(""); setBusy(true);
    try {
      const response = await fetch(endpoint, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ consumerKey, consumerSecret, shortcode, passkey, environment, transactionType, enabled }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not save configuration");
      setConfig({ shortcode, environment, transaction_type: transactionType, enabled, credentials_saved: true });
      setConsumerKey(""); setConsumerSecret(""); setPasskey("");
      setNotice("Configuration saved. Secret values are stored encrypted and are not shown again.");
    } catch (e) { setError(e instanceof Error ? e.message : "Could not save configuration"); }
    finally { setBusy(false); }
  }

  return <section className="workspace-panel" style={{ maxWidth: 820 }}>
    <div className="panel-heading"><div><h3>{title}</h3><p>{description}</p></div></div>
    {loading ? <p className="empty-state">Loading integration settings…</p> : <>
      {config?.credentials_saved && <p className="store-state">Credentials saved · {config.environment} · {config.enabled ? "Enabled" : "Disabled"}</p>}
      {error && <p className="form-error dashboard-error" role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      <form className="auth-form store-form" onSubmit={save}>
        <label htmlFor="mpesa-env">Daraja environment</label>
        <select id="mpesa-env" value={environment} onChange={e => setEnvironment(e.target.value as "sandbox" | "production")}><option value="sandbox">Sandbox testing</option><option value="production">Production</option></select>
        <label htmlFor="mpesa-key">Consumer key</label>
        <input id="mpesa-key" autoComplete="off" value={consumerKey} onChange={e => setConsumerKey(e.target.value)} required placeholder="Enter Daraja consumer key" />
        <label htmlFor="mpesa-secret">Consumer secret</label>
        <input id="mpesa-secret" type="password" autoComplete="new-password" value={consumerSecret} onChange={e => setConsumerSecret(e.target.value)} required placeholder="Enter Daraja consumer secret" />
        <label htmlFor="mpesa-shortcode">Business shortcode / till</label>
        <input id="mpesa-shortcode" inputMode="numeric" value={shortcode} onChange={e => setShortcode(e.target.value)} required pattern="[0-9]{5,7}" placeholder="e.g. 174379" />
        <label htmlFor="mpesa-passkey">Lipa Na M-Pesa passkey</label>
        <input id="mpesa-passkey" type="password" autoComplete="new-password" value={passkey} onChange={e => setPasskey(e.target.value)} required placeholder="Enter passkey" />
        <label htmlFor="mpesa-type">Transaction type</label>
        <select id="mpesa-type" value={transactionType} onChange={e => setTransactionType(e.target.value as "CustomerPayBillOnline" | "CustomerBuyGoodsOnline")}><option value="CustomerPayBillOnline">PayBill</option><option value="CustomerBuyGoodsOnline">Buy Goods / Till</option></select>
        <label><input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} /> Enable M-Pesa for this scope</label>
        <p className="billing-note">Credentials are encrypted at rest. Secret fields are write-only. Production mode should only be enabled after callback and reconciliation tests pass.</p>
        <button className="button button-dark" disabled={busy}>{busy ? "Saving securely…" : "Save M-Pesa settings"}</button>
      </form>
    </>}
  </section>;
}
