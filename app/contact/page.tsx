"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, CheckCircle2, Clock3, Mail, MapPin, MessageSquareText, Send } from "lucide-react";

type FormState = "idle" | "sending" | "sent" | "error";

export default function ContactPage() {
  const [state,setState] = useState<FormState>("idle");
  const [error,setError] = useState("");
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setState("sending");setError("");
    const form=event.currentTarget;
    const data=Object.fromEntries(new FormData(form).entries());
    try {
      const response=await fetch("/api/contact",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(data)});
      const result=await response.json();
      if(!response.ok) throw new Error(result.error || "We couldn't send your message. Please try again.");
      setState("sent");form.reset();
    } catch(e) {
      setError(e instanceof Error?e.message:"Something went wrong. Please try again.");
      setState("error");
    }
  }
  return <main className="commerce-marketing cm-inner-page">
    <header className="cm-header">
      <Link className="cm-brand" href="/" aria-label="MobiWave Commerce home"><img src="/branding/mw-logo.svg" alt="MobiWave Innovations"/><span className="cm-brand-divider"/><strong>Commerce</strong></Link>
      <nav className="cm-nav" aria-label="Main navigation"><Link href="/">Home</Link><Link href="/about">About</Link><Link href="/#features">Features</Link></nav>
      <div className="cm-header-actions"><Link className="cm-login" href="/login">Log in</Link><Link className="cm-button cm-button-primary cm-button-small" href="/signup">Get started <ArrowRight size={15}/></Link></div>
    </header>
    <section className="cm-contact-hero"><span className="cm-eyebrow"><span className="cm-eyebrow-dot"/> WE’RE HERE TO HELP</span><h1>Let’s talk about <span>your business.</span></h1><p>Questions about getting started, setting up your shop or working with MobiWave? Send us a message and our team will get back to you.</p></section>
    <section className="cm-contact-layout">
      <aside className="cm-contact-aside">
        <span className="cm-section-kicker">GET IN TOUCH</span><h2>We’d love to <span>hear from you.</span></h2><p>Tell us what you’re working on and how we can help. Your message goes directly to the MobiWave team.</p>
        <div className="cm-contact-detail"><span><Mail size={18}/></span><div><b>Email</b><a href="mailto:sales@mobiwave.co.ke">sales@mobiwave.co.ke</a></div></div>
        <div className="cm-contact-detail"><span><MapPin size={18}/></span><div><b>Based in</b><small>Kenya</small></div></div>
        <div className="cm-contact-note"><Clock3 size={16}/><span>Our team will respond as soon as possible during business hours.</span></div>
      </aside>
      <div className="cm-contact-form-wrap">
        {state==="sent" ? <div className="cm-contact-success"><span><CheckCircle2 size={27}/></span><h2>Message received.</h2><p>Thank you for contacting MobiWave. Your message has been sent to our team. We’ll be in touch.</p><button className="cm-button cm-button-primary" onClick={()=>setState("idle")}>Send another message</button></div> :
        <form className="cm-contact-form" onSubmit={submit}>
          <div className="cm-form-heading"><h2>Send us a message</h2><p>Fields marked with * are required.</p></div>
          <div className="cm-form-grid">
            <label>Your name *<input name="name" autoComplete="name" required maxLength={100} placeholder="Full name"/></label>
            <label>Email address *<input name="email" type="email" autoComplete="email" required maxLength={254} placeholder="you@company.com"/></label>
            <label>Phone number<input name="phone" type="tel" autoComplete="tel" maxLength={40} placeholder="+254..."/></label>
            <label>What is this about? *<select name="subject" required defaultValue=""><option value="" disabled>Select a topic</option><option>Getting started</option><option>Shop setup</option><option>Payments and integrations</option><option>Technical support</option><option>Partnerships</option><option>Other enquiry</option></select></label>
            <label className="cm-form-full">Your message *<textarea name="message" required minLength={10} maxLength={5000} rows={6} placeholder="Tell us a little about what you need..."/></label>
            <label className="cm-honeypot" aria-hidden="true">Leave this field empty<input name="website" tabIndex={-1} autoComplete="off"/></label>
          </div>
          {state==="error"&&<p className="cm-form-error" role="alert">{error}</p>}
          <div className="cm-form-submit"><button className="cm-button cm-button-primary" type="submit" disabled={state==="sending"}>{state==="sending"?"Sending...":"Send message"} <Send size={15}/></button><small>We’ll only use your details to respond to this enquiry.</small></div>
        </form>}
      </div>
    </section>
    <section className="cm-contact-bottom"><MessageSquareText size={21}/><div><b>Already using MobiWave Commerce?</b><p>Sign in to your workspace for account and store-related support.</p></div><Link className="cm-text-link" href="/login">Go to login <ArrowRight size={15}/></Link></section>
    <footer className="cm-footer"><Link className="cm-brand cm-footer-brand" href="/"><img src="/branding/mw-logo.svg" alt="MobiWave Innovations"/><span className="cm-brand-divider"/><strong>Commerce</strong></Link><span>Commerce tools for businesses ready to grow.</span><span>© {new Date().getFullYear()} MobiWave Innovations Ltd</span></footer>
  </main>;
}
