"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { ArrowRight, ShoppingBag } from "lucide-react";
import { authClient } from "@/lib/auth-client";

export default function SignupPage() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setNotice("");
    setBusy(true);

    try {
      const result = await authClient.signUp.email({
        name: name.trim(),
        email: email.trim(),
        password,
        callbackURL: "/dashboard",
      });

      if (result.error) {
        setError(result.error.message || "Could not create your account. Please try again.");
      } else {
        setNotice(
          "Your account has been created. If email verification is enabled, check your inbox for the confirmation link. Otherwise, sign in to continue.",
        );
      }
    } catch {
      setError("Unable to reach the account service. Please try again in a moment.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-page">
      <Link className="brand auth-brand" href="/">
        <span className="brand-mark"><ShoppingBag size={19} /></span>
        <span>MobiWave <strong>Commerce</strong></span>
      </Link>
      <section className="auth-panel">
        <span className="eyebrow">START SELLING ONLINE</span>
        <h1>Create your account.</h1>
        <p>Set up your first store and begin adding products.</p>
        <form onSubmit={submit} className="auth-form">
          <label htmlFor="name">Your name</label>
          <input
            id="name"
            autoComplete="name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            minLength={2}
            maxLength={100}
            required
          />
          <label htmlFor="email">Email address</label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />
          <label htmlFor="password">Password <span>12 characters minimum</span></label>
          <input
            id="password"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            minLength={12}
            maxLength={128}
            required
          />
          <button className="button button-dark" disabled={busy}>
            {busy ? "Creating account…" : "Create account"} <ArrowRight size={16} />
          </button>
          {error && <p className="form-error" role="alert">{error}</p>}
          {notice && <p className="billing-note" role="status">{notice}</p>}
        </form>
        <p className="auth-switch">Already have an account? <Link href="/login">Sign in</Link></p>
      </section>
      <p className="auth-legal">By creating an account, you agree to use the platform responsibly.</p>
    </main>
  );
}
