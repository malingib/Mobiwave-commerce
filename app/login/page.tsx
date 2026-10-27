"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { ArrowRight, ShoppingBag } from "lucide-react";
import { authClient } from "@/lib/auth-client";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(""); setBusy(true);
    try {
      const result = await authClient.signIn.email({ email, password, callbackURL: "/dashboard" });
      if (result.error) setError(result.error.message || "Could not sign in.");
      else window.location.assign("/dashboard");
    } catch { setError("Unable to sign in right now. Please try again."); }
    finally { setBusy(false); }
  }

  return <main className="auth-page"><Link className="brand auth-brand" href="/"><span className="brand-mark"><ShoppingBag size={19} /></span><span>MobiWave <strong>Commerce</strong></span></Link><section className="auth-panel"><span className="eyebrow">WELCOME BACK</span><h1>Sign in to your shop.</h1><p>Manage products, orders and your online storefront.</p><form onSubmit={submit} className="auth-form"><label htmlFor="email">Email address</label><input id="email" type="email" autoComplete="email" value={email} onChange={e=>setEmail(e.target.value)} required/><label htmlFor="password">Password</label><input id="password" type="password" autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)} required/><button className="button button-dark" disabled={busy}>{busy ? "Signing in…" : "Sign in"} <ArrowRight size={16}/></button>{error && <p className="form-error" role="alert">{error}</p>}</form><p className="auth-switch">New to MobiWave Commerce? <Link href="/signup">Create an account</Link></p></section><p className="auth-legal">Secure account access for your business.</p></main>;
}
