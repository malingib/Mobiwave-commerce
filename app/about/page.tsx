import Link from "next/link";
import { ArrowRight, Boxes, MessageSquareText, ShoppingBag, Workflow } from "lucide-react";

export const metadata = {
  title: "About MobiWave Commerce | MobiWave Innovations",
  description: "Learn about MobiWave Commerce, a practical commerce platform from MobiWave Innovations for businesses in Kenya.",
};

const principles = [
  { icon: ShoppingBag, title: "Commerce made practical", text: "Tools that help businesses put products online, organise orders and serve customers without unnecessary complexity." },
  { icon: MessageSquareText, title: "Connected customer experiences", text: "Commerce works better when storefronts, conversations and customer updates work together." },
  { icon: Workflow, title: "Built around real workflows", text: "A focus on the everyday work of running a business: products, orders, payments, delivery and customer communication." },
];

export default function AboutPage() {
  return <main className="commerce-marketing cm-inner-page">
    <header className="cm-header">
      <Link className="cm-brand" href="/" aria-label="MobiWave Commerce home"><img src="/branding/mw-logo.svg" alt="MobiWave Innovations" /><span className="cm-brand-divider" /><strong>Commerce</strong></Link>
      <nav className="cm-nav" aria-label="Main navigation"><Link href="/">Home</Link><Link href="/#features">Features</Link><Link href="/#pricing">Pricing</Link><Link href="/about" aria-current="page">About</Link><Link href="/contact">Contact</Link></nav>
      <div className="cm-header-actions"><Link className="cm-login" href="/login">Log in</Link><Link className="cm-button cm-button-primary cm-button-small" href="/signup">Get started <ArrowRight size={15}/></Link></div>
    </header>

    <section className="cm-inner-hero">
      <div className="cm-inner-copy">
        <span className="cm-section-kicker">ABOUT MOBIWAVE COMMERCE</span>
        <h1>Commerce tools for the way <span>business really works.</span></h1>
        <p>MobiWave Commerce is part of the MobiWave Innovations ecosystem, built to help businesses establish an online presence, manage day-to-day selling and stay connected with their customers.</p>
        <div className="cm-inner-actions"><Link className="cm-button cm-button-primary" href="/signup">Create your shop <ArrowRight size={16}/></Link><Link className="cm-text-link" href="/contact">Talk to our team <ArrowRight size={15}/></Link></div>
      </div>
      <div className="cm-about-visual"><img src="/branding/martex-hero-nobg.webp" alt="MobiWave digital commerce and customer engagement" /></div>
    </section>

    <section className="cm-section cm-about-section">
      <div className="cm-section-heading"><div><span className="cm-section-kicker">THE MOBIWAVE APPROACH</span><h2>Useful technology. <span>Clear outcomes.</span></h2></div><p>We focus on tools that reduce friction between businesses and the people they serve.</p></div>
      <div className="cm-feature-grid">{principles.map(({icon:Icon,title,text})=><article className="cm-feature-item" key={title}><span className="cm-feature-icon"><Icon size={21}/></span><h3>{title}</h3><p>{text}</p></article>)}</div>
    </section>

    <section className="cm-about-band"><div><span className="cm-section-kicker">PART OF MOBIWAVE INNOVATIONS</span><h2>Commerce is one part of a connected business ecosystem.</h2><p>MobiWave Innovations develops digital products and communication services that help organisations work smarter and reach their customers.</p><a href="https://mobiwave.co.ke" target="_blank" rel="noreferrer">Explore MobiWave Innovations <ArrowRight size={15}/></a></div><Boxes size={88} strokeWidth={1}/></section>

    <footer className="cm-footer"><Link className="cm-brand cm-footer-brand" href="/"><img src="/branding/mw-logo.svg" alt="MobiWave Innovations"/><span className="cm-brand-divider"/><strong>Commerce</strong></Link><span>Commerce tools for businesses ready to grow.</span><nav className="cm-footer-links"><Link href="/about">About</Link><Link href="/contact">Contact</Link><a href="https://mobiwave.co.ke">MobiWave</a></nav><span>© {new Date().getFullYear()} MobiWave Innovations Ltd</span></footer>
  </main>;
}
