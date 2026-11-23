"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { ArrowRight, Mail, MapPin, Phone } from "lucide-react";

type FormState = { name: string; email: string; business: string; subject: string; message: string; website: string };

const initial: FormState = { name: "", email: "", business: "", subject: "General enquiry", message: "", website: "" };

export default function ContactPage() {
  const [form, setForm] = useState<FormState>(initial);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ kind: "success" | "error"; message: string } | null>(null);

  function update(field: keyof FormState, value: string) {
    setForm(current => ({ ...current, [field]: value }));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setStatus(null);
    try {
      const response = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const result = await response.json() as { error?: string; message?: string };
      if (!response.ok) throw new Error(result.error || "We couldn't send your message. Please try again.");
      setForm(initial);
      setStatus({ kind: "success", message: result.message || "Your message has been sent. Our team will get back to you." });
    } catch (error) {
      setStatus({ kind: "error", message: error instanceof Error ? error.message : "We couldn't send your message. Please try again." });
    } finally {
      setBusy(false);
    }
  }

  return <main className="commerce-marketing cm-inner-page">
    <header className="cm-header">
      <Link className="cm-brand" href="/" aria-label="MobiWave Commerce home"><img src="/branding/mw-logo.svg" alt="MobiWave Innovations"/><span className="cm-brand-divider"/><strong>Commerce</strong></Link>
      <nav className="cm-nav" aria-label="Main navigation"><Link href="/">Home</Link><Link href="/#features">Features</Link><Link href="/#pricing">Pricing</Link><Link href="/about">About</Link><Link href="/contact" aria-current="page">Contact</Link></nav>
      <div className="cm-header-actions"><Link className="cm-login" href="/login">Log in</Link><Link className="cm-button cm-button-primary cm-button-small" href="/signup">Get started <ArrowRight size={15}/></Link></div>
    </header>
    <nav className="cm-inner-mobile-nav" aria-label="Mobile navigation"><Link href="/">Home</Link><Link href="/#features">Features</Link><Link href="/#pricing">Pricing</Link><Link href="/about">About</Link><Link href="/contact">Contact</Link></nav>

    <section className="cm-contact-hero"><div><span className="cm-section-kicker">CONTACT MOBIWAVE COMMERCE</span><h1>Let’s talk about <span>your business.</span></h1><p>Questions about getting started, setting up your shop or using Commerce? Send our team a message and we’ll get back to you.</p><div className="cm-contact-details">
      <a href="mailto:sales@mobiwave.co.ke"><span><Mail size={18}/></span><div><small>EMAIL OUR TEAM</small><strong>sales@mobiwave.co.ke</strong></div></a>
      <a href="https://mobiwave.co.ke/contact"><span><Phone size={18}/></span><div><small>CONTACT MOBIWAVE</small><strong>Company contact details</strong></div></a>
      <div><span><MapPin size={18}/></span><div><small>BASED IN</small><strong>Kenya</strong></div></div>
    </div></div>
      <form className="cm-contact-form" onSubmit={submit}>
        <div className="cm-contact-form-heading"><span className="cm-section-kicker">SEND AN ENQUIRY</span><h2>How can we help?</h2><p>Complete the form and our team will respond by email.</p></div>
        <div className="cm-form-grid">
          <label>Your name<input value={form.name} onChange={e=>update("name",e.target.value)} autoComplete="name" minLength={2} maxLength={100} required/></label>
          <label>Email address<input type="email" value={form.email} onChange={e=>update("email",e.target.value)} autoComplete="email" maxLength={254} required/></label>
          <label className="cm-form-wide">Business name <span className="cm-optional">(optional)</span><input value={form.business} onChange={e=>update("business",e.target.value)} maxLength={120}/></label>
          <label className="cm-form-wide">Subject<select value={form.subject} onChange={e=>update("subject",e.target.value)}><option>General enquiry</option><option>Getting started</option><option>Pricing and usage</option><option>Technical support</option><option>Partnerships</option></select></label>
          <label className="cm-form-wide">Message<textarea value={form.message} onChange={e=>update("message",e.target.value)} minLength={10} maxLength={5000} rows={5} required/></label>
          <label className="cm-honeypot" aria-hidden="true" tabIndex={-1}>Leave this field empty<input name="website" autoComplete="off" tabIndex={-1} value={form.website} onChange={e=>update("website",e.target.value)}/></label>
        </div>
        <button className="cm-button cm-button-primary cm-contact-submit" disabled={busy}>{busy ? "Sending message…" : "Send message"} <ArrowRight size={16}/></button>
        {status && <p className={status.kind==="success"?"cm-form-success":"cm-form-error"} role={status.kind==="success"?"status":"alert"}>{status.message}</p>}
        <small className="cm-form-privacy">Your details will only be used to respond to this enquiry.</small>
      </form>
    </section>

    <footer className="cm-footer"><Link className="cm-brand cm-footer-brand" href="/"><img src="/branding/mw-logo.svg" alt="MobiWave Innovations"/><span className="cm-brand-divider"/><strong>Commerce</strong></Link><span>Commerce tools for businesses ready to grow.</span><nav className="cm-footer-links"><Link href="/about">About</Link><Link href="/contact">Contact</Link><a href="https://mobiwave.co.ke">MobiWave</a></nav><span>© {new Date().getFullYear()} MobiWave Innovations Ltd</span></footer>
  </main>;
}
