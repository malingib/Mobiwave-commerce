"use client";

import { ArrowDownRight, ArrowRight, Check, ChevronDown, CircleHelp, Globe2, MessageSquareText, Package, ShoppingBag, Store, Truck, Zap } from "lucide-react";
import { useState } from "react";

const benefits = [
  { icon: Store, title: "Your own online shop", text: "A clean storefront on your own MobiWave address. No web development needed." },
  { icon: Package, title: "Orders in one place", text: "Keep products, customer details and order status together instead of scattered chats." },
  { icon: MessageSquareText, title: "Customer updates", text: "Build on MobiWave SMS for useful order and delivery notifications." },
];

const steps = [
  ["01", "Create your shop", "Choose a store name and get your own shop address."],
  ["02", "Add your products", "Upload product details and prices, then publish when ready."],
  ["03", "Receive orders", "Manage incoming orders and keep customers informed."],
];

export default function HomePage() {
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);

  return (
    <main>
      <header className="site-header">
        <a className="brand" href="#" aria-label="MobiWave Commerce home">
          <span className="brand-mark"><ShoppingBag size={19} strokeWidth={2.3} /></span>
          <span>MobiWave <strong>Commerce</strong></span>
        </a>
        <nav className="desktop-nav" aria-label="Main navigation">
          <a href="#how-it-works">How it works</a>
          <a href="#features">Features</a>
          <a href="#pricing">Pricing</a>
        </nav>
        <a className="button button-dark button-small" href="#get-started">Get started <ArrowRight size={15} /></a>
      </header>

      <section className="hero">
        <div className="hero-copy">
          <div className="eyebrow"><span className="status-dot" /> MADE FOR KENYAN BUSINESSES</div>
          <h1>Your business deserves <span>its own place online.</span></h1>
          <p className="hero-lede">Open a simple online shop, organise your orders and keep customers in the loop — without starting with an expensive website.</p>
          <div className="hero-actions">
            <a className="button button-dark" href="#get-started">Start your free shop <ArrowRight size={16} /></a>
            <a className="text-link" href="#how-it-works">See how it works <ArrowDownRight size={16} /></a>
          </div>
          <div className="trust-line"><span className="check-icon"><Check size={12} /></span> Start free · No coding required · Built for mobile</div>
        </div>
        <div className="store-preview" aria-label="Illustrative storefront preview">
          <div className="preview-browser">
            <div className="browser-dots"><i /><i /><i /></div>
            <span>shop.mobiwave.co.ke</span>
            <Globe2 size={14} />
          </div>
          <div className="preview-shop">
            <div className="preview-shop-head"><div><span className="mini-label">YOUR STORE</span><h2>Atelier & Co.</h2></div><button aria-label="Open store menu"><ChevronDown size={16} /></button></div>
            <p className="preview-intro">Everyday pieces, thoughtfully made.</p>
            <div className="product-grid">
              <div className="product-tile product-one"><span>NEW ARRIVAL</span><div className="product-art art-bag"><ShoppingBag size={45} strokeWidth={1.2} /></div><b>Everyday tote</b><small>KES 1,800</small></div>
              <div className="product-tile product-two"><div className="product-art art-vase"><div className="vase" /></div><b>Studio vase</b><small>KES 2,400</small></div>
            </div>
            <div className="preview-order"><span className="order-icon"><Package size={16} /></span><span><b>New order received</b><small>Order #MW-1042 · Just now</small></span><span className="order-status">NEW</span></div>
          </div>
          <div className="floating-note"><span className="floating-check"><Check size={14} /></span><span><b>Your shop is live</b><small>Ready to share with customers</small></span></div>
        </div>
      </section>

      <section className="proof-strip" aria-label="Platform highlights">
        <div><span className="proof-number">01</span><span>Simple setup</span></div>
        <div><span className="proof-number">02</span><span>Mobile-first shopping</span></div>
        <div><span className="proof-number">03</span><span>Local payment workflows</span></div>
        <div><span className="proof-number">04</span><span>MobiWave messaging</span></div>
      </section>

      <section className="section features-section" id="features">
        <div className="section-heading"><div><span className="eyebrow">THE ESSENTIALS, DONE WELL</span><h2>Less admin. More selling.</h2></div><p>The tools to start taking orders online, without the complexity that gets in the way.</p></div>
        <div className="feature-grid">{benefits.map(({ icon: Icon, title, text }) => <article className="feature-item" key={title}><span className="feature-icon"><Icon size={21} strokeWidth={1.7} /></span><h3>{title}</h3><p>{text}</p><a href="#get-started">Explore the platform <ArrowRight size={14} /></a></article>)}</div>
      </section>

      <section className="workflow-section" id="how-it-works">
        <div className="section workflow-inner"><div className="workflow-intro"><span className="eyebrow">A SMALL START. ROOM TO GROW.</span><h2>From first product to first order.</h2><p>Start with the essentials. Add more tools as your business grows.</p></div><div className="step-list">{steps.map(([number, title, text]) => <div className="step-row" key={number}><span className="step-number">{number}</span><div><h3>{title}</h3><p>{text}</p></div><ArrowRight size={17} /></div>)}</div></div>
      </section>

      <section className="section pricing-section" id="pricing">
        <div className="section-heading"><div><span className="eyebrow">SIMPLE BY DESIGN</span><h2>Start free. Grow when ready.</h2></div><p>Core storefront and everyday order management should be useful from day one. Paid plans add capabilities as you need them.</p></div>
        <div className="pricing-row"><div><span className="plan-label">FREE</span><h3>KES 0 <small>/ forever</small></h3><p>For merchants getting their first shop online.</p></div><ul><li><Check size={15} /> Hosted shop address</li><li><Check size={15} /> Product catalogue and storefront</li><li><Check size={15} /> Essential order management</li><li><Check size={15} /> Manual payment and cash-on-delivery workflow</li></ul><div className="pricing-note"><CircleHelp size={16} /><span>Paid upgrades such as custom domains and advanced automation will be introduced transparently.</span></div></div>
        <p className="pricing-disclaimer">Product direction preview. Plans, allowances and payment integrations are still being implemented; no live merchant account or checkout is available yet.</p>
      </section>

      <section className="cta-section" id="get-started">
        <div className="cta-content"><span className="eyebrow">YOUR NEXT CHAPTER STARTS HERE</span><h2>Give your business a home online.</h2><p>Join the early-access list and help shape a commerce platform made for the way Kenyan businesses sell.</p>
          {submitted ? <div className="success-message"><Check size={17} /> Thanks — this demo has recorded your local interaction only. Early-access sign-up is not connected yet.</div> : <form className="signup-form" onSubmit={(event) => { event.preventDefault(); if (email.trim()) setSubmitted(true); }}><label className="sr-only" htmlFor="early-access-email">Email address</label><input id="early-access-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="Your email address" required /><button className="button button-light" type="submit">Get early access <ArrowRight size={16} /></button></form>}
          <small className="cta-footnote"><Truck size={14} /> Built for the realities of local commerce.</small>
        </div>
      </section>

      <footer className="site-footer"><a className="brand footer-brand" href="#"><span className="brand-mark"><ShoppingBag size={17} /></span><span>MobiWave <strong>Commerce</strong></span></a><span>Commerce tools for businesses ready to grow.</span><span>© {new Date().getFullYear()} MobiWave Innovations Ltd</span></footer>
    </main>
  );
}
