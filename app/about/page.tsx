import Link from "next/link";
import { ArrowRight, Globe2, MessageSquareText, Package, Store } from "lucide-react";

const principles = [
  { icon: Store, title: "Practical by design", text: "Commerce tools should make everyday work simpler. We focus on the essentials merchants need to present products and manage orders." },
  { icon: MessageSquareText, title: "Connected customer experiences", text: "A shop is more than a catalogue. MobiWave brings commerce closer to the communication businesses already use with their customers." },
  { icon: Globe2, title: "Built for local business", text: "We are building with the realities of Kenyan businesses in mind: mobile-first customers, local payments and the importance of trust." },
];

export const metadata = { title: "About MobiWave Commerce | MobiWave Innovations", description: "Learn about MobiWave Commerce and how MobiWave Innovations is helping Kenyan businesses bring storefronts, orders and customer communication together." };

export default function AboutPage() {
  return <main className="commerce-marketing cm-inner-page">
    <header className="cm-header">
      <Link className="cm-brand" href="/" aria-label="MobiWave Commerce home"><img src="/branding/mw-logo.svg" alt="MobiWave Innovations" /><span className="cm-brand-divider" /><strong>Commerce</strong></Link>
      <nav className="cm-nav" aria-label="Main navigation"><Link href="/">Home</Link><Link href="/#features">Features</Link><Link href="/contact">Contact</Link></nav>
      <div className="cm-header-actions"><Link className="cm-login" href="/login">Log in</Link><Link className="cm-button cm-button-primary cm-button-small" href="/signup">Get started <ArrowRight size={15}/></Link></div>
    </header>
    <section className="cm-page-hero">
      <div className="cm-page-hero-inner">
        <span className="cm-eyebrow"><span className="cm-eyebrow-dot"/> ABOUT MOBIWAVE COMMERCE</span>
        <h1>Technology that helps local businesses <span>move forward.</span></h1>
        <p>MobiWave Commerce is part of the MobiWave Innovations ecosystem — bringing online storefronts, order management and customer communication into a more connected experience for businesses.</p>
        <div className="cm-hero-actions"><Link className="cm-button cm-button-primary" href="/signup">Create your shop <ArrowRight size={16}/></Link><Link className="cm-text-link" href="/contact">Talk to our team <ArrowRight size={15}/></Link></div>
      </div>
      <div className="cm-about-visual" aria-label="MobiWave Commerce connects storefronts, products and customer conversations">
        <div className="cm-about-orbit cm-orbit-one"/><div className="cm-about-orbit cm-orbit-two"/>
        <div className="cm-about-core"><img src="/branding/mw-logo.svg" alt="MobiWave"/><span>COMMERCE</span></div>
        <div className="cm-about-node cm-node-store"><Store size={20}/><b>Storefronts</b></div>
        <div className="cm-about-node cm-node-products"><Package size={20}/><b>Products</b></div>
        <div className="cm-about-node cm-node-messages"><MessageSquareText size={20}/><b>Conversations</b></div>
      </div>
    </section>
    <section className="cm-section cm-about-story">
      <div><span className="cm-section-kicker">WHO WE ARE</span><h2>Part of a wider <span>innovation ecosystem.</span></h2></div>
      <div className="cm-about-copy">
        <p>MobiWave Innovations builds digital products and services that help organisations communicate, operate and serve their customers more effectively.</p>
        <p>Commerce extends that work to businesses that want a straightforward way to establish an online presence, organise their products and orders, and build better customer relationships.</p>
        <p>Our approach is grounded in useful technology: clear workflows, dependable integrations and tools that can grow with the business.</p>
        <Link className="cm-inline-link" href="https://mobiwave.co.ke" target="_blank" rel="noreferrer">Explore MobiWave Innovations <ArrowRight size={15}/></Link>
      </div>
    </section>
    <section className="cm-about-principles">
      <div className="cm-section cm-about-principles-inner">
        <div className="cm-section-heading"><div><span className="cm-section-kicker">WHAT GUIDES US</span><h2>Useful technology. <span>Real progress.</span></h2></div><p>We believe good business software should be clear to use, thoughtfully connected and grounded in the needs of the people using it.</p></div>
        <div className="cm-feature-grid">{principles.map(({icon:Icon,title,text})=><article className="cm-feature-item" key={title}><span className="cm-feature-icon"><Icon size={21}/></span><h3>{title}</h3><p>{text}</p></article>)}</div>
      </div>
    </section>
    <section className="cm-about-bottom"><span className="cm-section-kicker">BUILD YOUR NEXT CHAPTER</span><h2>Make room for your business to grow.</h2><p>Start with your online shop. Bring your products and customer experience together with MobiWave Commerce.</p><div className="cm-hero-actions"><Link className="cm-button cm-button-primary" href="/signup">Get started <ArrowRight size={16}/></Link><Link className="cm-text-link" href="/contact">Contact us <ArrowRight size={15}/></Link></div></section>
    <footer className="cm-footer"><Link className="cm-brand cm-footer-brand" href="/"><img src="/branding/mw-logo.svg" alt="MobiWave Innovations"/><span className="cm-brand-divider"/><strong>Commerce</strong></Link><span>Commerce tools for businesses ready to grow.</span><span>© {new Date().getFullYear()} MobiWave Innovations Ltd</span></footer>
  </main>;
}
