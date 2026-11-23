"use client";

import { useState } from "react";
import {
  ArrowDownRight, ArrowRight, Check, Globe2,
  MessageSquareText, Package, Store, Truck, Menu, X,
} from "lucide-react";

const benefits = [
  { icon: Store, title: "Your own online shop", text: "A clean, shareable storefront on your MobiWave address. Set up your catalogue without building a website from scratch." },
  { icon: Package, title: "Orders in one place", text: "Keep products, customer details and order progress together instead of scattered across chats and spreadsheets." },
  { icon: MessageSquareText, title: "Customer updates", text: "Connect commerce with MobiWave messaging to keep customers informed about orders and delivery." },
];

const steps = [
  ["01", "Create your shop", "Choose a store name and set up your online storefront."],
  ["02", "Add your products", "Publish product details, images and prices in your catalogue."],
  ["03", "Manage every order", "Keep incoming orders organised and customers up to date."],
];

export default function HomePage() {
  const [mobileOpen, setMobileOpen] = useState(false);
  return (
    <main className="commerce-marketing">
      <header className="cm-header">
        <a className="cm-brand" href="/" aria-label="MobiWave Commerce home">
          <img src="/branding/mw-logo.svg" alt="MobiWave Innovations" />
          <span className="cm-brand-divider" />
          <strong>Commerce</strong>
        </a>
        <nav className="cm-nav" aria-label="Main navigation">
          <a href="#how-it-works">How it works</a>
          <a href="#features">Features</a>
          <a href="#pricing">Pricing</a>
        </nav>
        <div className="cm-header-actions">
          <a className="cm-login" href="/login">Log in</a>
          <a className="cm-button cm-button-primary cm-button-small" href="/signup">Get started <ArrowRight size={15} /></a>
          <button className="cm-menu-toggle" type="button" aria-label={mobileOpen ? "Close navigation" : "Open navigation"} aria-expanded={mobileOpen} onClick={() => setMobileOpen(v => !v)}>
            {mobileOpen ? <X size={21} /> : <Menu size={21} />}
          </button>
        </div>
        {mobileOpen && <nav className="cm-mobile-nav" aria-label="Mobile navigation">
          <a href="#how-it-works" onClick={() => setMobileOpen(false)}>How it works</a>
          <a href="#features" onClick={() => setMobileOpen(false)}>Features</a>
          <a href="#pricing" onClick={() => setMobileOpen(false)}>Pricing</a>
          <a href="/login" onClick={() => setMobileOpen(false)}>Log in</a>
          <a href="/signup" onClick={() => setMobileOpen(false)}>Create your shop <ArrowRight size={15} /></a>
        </nav>}
      </header>

      <section className="cm-hero">
        <div className="cm-hero-glow" aria-hidden="true" />
        <div className="cm-hero-inner">
          <div className="cm-hero-copy">
            <div className="cm-eyebrow"><span className="cm-eyebrow-dot" /> COMMERCE, CONNECTED BY MOBIWAVE</div>
            <h1>Your business deserves <span>its own place online.</span></h1>
            <p className="cm-hero-lede">Open a simple online shop, organise your orders and keep customers in the loop — all in one calm workspace built for Kenyan businesses.</p>
            <div className="cm-hero-actions">
              <a className="cm-button cm-button-primary" href="/signup">Create your shop <ArrowRight size={16} /></a>
              <a className="cm-text-link" href="#how-it-works">See how it works <ArrowDownRight size={16} /></a>
            </div>
            <div className="cm-trust-line"><span><Check size={12} /></span> No coding required <i /> Built for mobile</div>
          </div>
          <div className="cm-hero-visual">
            <div className="cm-visual-glow" aria-hidden="true" />
            <img
              className="cm-hero-image"
              src="/branding/martex-hero-nobg.webp"
              alt="MobiWave customer engagement illustration"
              fetchPriority="high"
              decoding="async"
            />
            <div className="cm-floating-card cm-floating-top"><span className="cm-floating-icon"><Globe2 size={16} /></span><span><b>Your shop, online</b><small>Ready to share with customers</small></span></div>
            <div className="cm-floating-card cm-floating-bottom"><span className="cm-floating-check"><Check size={14} /></span><span><b>New order received</b><small>Keep every order moving</small></span></div>
          </div>
        </div>
        <svg className="cm-wave" viewBox="0 0 1440 110" preserveAspectRatio="none" aria-hidden="true">
          <path d="M0 54 C240 105 480 5 720 45 C960 85 1200 25 1440 65 L1440 110 L0 110Z" fill="#fff" />
        </svg>
      </section>

      <section className="cm-proof" aria-label="Platform highlights">
        <div><span>01</span><b>Simple setup</b></div>
        <div><span>02</span><b>Mobile-first storefronts</b></div>
        <div><span>03</span><b>Local commerce workflows</b></div>
        <div><span>04</span><b>MobiWave messaging</b></div>
      </section>

      <section className="cm-section cm-features" id="features">
        <div className="cm-section-heading">
          <div><span className="cm-section-kicker">THE ESSENTIALS, DONE WELL</span><h2>Less admin. <span>More selling.</span></h2></div>
          <p>The tools to start taking orders online, without the complexity that gets in the way.</p>
        </div>
        <div className="cm-feature-grid">
          {benefits.map(({ icon: Icon, title, text }) => <article className="cm-feature-item" key={title}>
            <span className="cm-feature-icon"><Icon size={21} strokeWidth={1.7} /></span>
            <h3>{title}</h3><p>{text}</p>
            <a href="/signup">Explore the platform <ArrowRight size={14} /></a>
          </article>)}
        </div>
      </section>

      <section className="cm-workflow" id="how-it-works">
        <div className="cm-section cm-workflow-inner">
          <div className="cm-workflow-intro"><span className="cm-section-kicker">A SMALL START. ROOM TO GROW.</span><h2>From first product <span>to first order.</span></h2><p>Start with the essentials. Add more tools as your business grows.</p></div>
          <div className="cm-step-list">{steps.map(([number, title, text]) => <div className="cm-step-row" key={number}>
            <span className="cm-step-number">{number}</span><div><h3>{title}</h3><p>{text}</p></div><ArrowRight size={17} />
          </div>)}</div>
        </div>
      </section>

      <section className="cm-section cm-pricing" id="pricing">
        <div className="cm-section-heading">
          <div><span className="cm-section-kicker">TRANSPARENT, VOLUME-BASED RATES</span><h2>Pay for messaging <span>as you use it.</span></h2></div>
          <p>SMS usage is billed by monthly volume. Higher volumes receive a lower per-message rate, with no subscription package pricing.</p>
        </div>
        <div className="cm-usage-pricing">
          <div className="cm-usage-pricing-intro">
            <span className="cm-plan-label">MOBIWAVE SMS USAGE</span>
            <h3>One clear rate per SMS.</h3>
            <p>Choose the volume that matches your business. Rates are in Kenyan shillings and are charged per SMS sent.</p>
          </div>
          <div className="cm-usage-table-wrap">
            <table className="cm-usage-table">
              <thead><tr><th scope="col">Monthly SMS volume</th><th scope="col">Rate per SMS</th></tr></thead>
              <tbody>
                <tr><td>1 – 50,000</td><td><strong>KES 0.35</strong></td></tr>
                <tr><td>50,001 – 500,000</td><td><strong>KES 0.30</strong></td></tr>
                <tr><td>500,001 – 2,000,000</td><td><strong>KES 0.25</strong></td></tr>
                <tr><td>Above 2,000,000</td><td><strong>KES 0.20</strong></td></tr>
              </tbody>
            </table>
          </div>
          <p className="cm-usage-footnote">Volume-based SMS usage rates. Sender ID registration and any applicable third-party channel charges are handled separately where required.</p>
        </div>
      </section>

      <section className="cm-cta" id="get-started">
        <div className="cm-cta-glow" aria-hidden="true" />
        <div className="cm-cta-content"><span className="cm-section-kicker">YOUR NEXT CHAPTER STARTS HERE</span><h2>Give your business <span>a home online.</span></h2><p>Create your shop, add your products and make it easier for customers to find and order from you.</p>
          <a className="cm-button cm-button-cta" href="/signup">Create your shop <ArrowRight size={16} /></a>
          <small><Truck size={14} /> Built for the realities of local commerce.</small>
        </div>
      </section>

      <footer className="cm-footer">
        <a className="cm-brand cm-footer-brand" href="/" aria-label="MobiWave Commerce home"><img src="/branding/mw-logo.svg" alt="MobiWave Innovations" /><span className="cm-brand-divider" /><strong>Commerce</strong></a>
        <span>Commerce tools for businesses ready to grow.</span>
        <span>© {new Date().getFullYear()} MobiWave Innovations Ltd</span>
      </footer>
    </main>
  );
}
