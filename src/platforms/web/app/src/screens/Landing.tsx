import { Link } from 'react-router-dom';
import { Ic } from '../lib/icons';
import { SiteFooter } from './SiteFooter';
import { Wordmark } from '../ui/Wordmark';
import './landing.css';

const CONCIERGE_STEPS = [
  {
    id: 'intent',
    n: '01',
    title: 'You say what you want',
    text: 'Plain words, not a settings panel. Describe the thing you are trying to make.',
  },
  {
    id: 'pick',
    n: '02',
    title: 'It picks the tools',
    text: 'The concierge reads the intent, chooses the right models from the catalog, and wires the steps.',
  },
  {
    id: 'work',
    n: '03',
    title: 'You get the work',
    text: 'The result comes back, not a form. The controls are one click away when you want them.',
  },
];

const BREADTH = [
  {
    id: 'curated',
    icon: 'wand-sparkles',
    title: 'Curated models, open and closed',
    desc: 'A hand-picked set of open- and closed-source models, vetted and kept current.',
  },
  {
    id: 'modality',
    icon: 'palette',
    title: 'Every modality',
    desc: 'Image, video, language, audio — the same workspace across all of them.',
  },
  {
    id: 'byo',
    icon: 'globe',
    title: 'Bring your own endpoint',
    desc: 'Point at a model you host and it slots in beside the rest.',
  },
  {
    id: 'tools',
    icon: 'workflow',
    title: 'One set of tools',
    desc: 'Swap the model without swapping tools. Your workflow does not change.',
  },
];

export function Landing() {
  return (
    <div className="landing-page">
      <nav className="topnav">
        <Link to="/" className="brand" aria-label="noema home"><Wordmark height={22} /></Link>
        <div className="right">
          <Link className="btn-ghost" to="/pricing">Pricing</Link>
          <Link className="btn-ghost" to="/ceremony">Ceremony</Link>
          <Link className="btn" to="/onboard">Open app</Link>
        </div>
      </nav>

      <div className="hero">
        <span className="noema-glow hero-glow" aria-hidden="true" />
        <h1 className="hero-display">A complete studio.<br /><span className="accent">A concierge that builds with you.</span></h1>
        <hr className="noema-rule hero-rule" />
        <p className="lead">Curated open- and closed-source models. Describe what you want — a concierge picks the tools and makes it.</p>
        <div className="cta">
          <Link className="btn lg" to="/onboard">Get started <Ic name="arrow-right" /></Link>
          <Link className="btn-ghost" to="/pricing">See pricing</Link>
        </div>
        <div className="proof">no email · pay anonymously · your models or ours</div>
      </div>

      <div className="stance">
        <div className="in">
          <h2>
            Most AI tools hand you a blank box and a wall of settings.<br />
            <span className="dim">We built one that just makes the thing.</span>
          </h2>
          <div className="sub">
            Tell the concierge what you want. It picks from a curated set of open- and
            closed-source models, runs them, and hands back the work. The controls are
            there when you want them, never in your way when you don't.
          </div>
        </div>
      </div>

      <section className="lsec concierge-explainer">
        <h2 className="lsec-h">The concierge does the deciding.</h2>
        <p className="lsec-sub">
          It is the difference between a toolbox and a studio. You bring the intent;
          it handles the picking, the wiring, and the running.
        </p>
        <div className="steps">
          {CONCIERGE_STEPS.map((step) => (
            <div key={step.id} className="step">
              <div className="sn">{step.n}</div>
              <h3>{step.title}</h3>
              <p>{step.text}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="lsec breadth">
        <h2 className="lsec-h">Every model. One workspace.</h2>
        <p className="lsec-sub">
          A hand-picked catalog across every modality, or your own endpoint alongside
          them — without ever leaving the studio.
        </p>
        <div className="lfeat">
          {BREADTH.map((feat) => (
            <div key={feat.id} className="lf">
              <div className="li"><Ic name={feat.icon} /></div>
              <h3>{feat.title}</h3>
              <p>{feat.desc}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="lsec place">
        <div className="place-in">
          <span className="li"><Ic name="sparkles" /></span>
          <h2 className="lsec-h">Your work becomes a place.</h2>
          <p className="lsec-sub">
            Every creation lands in a space you can fly through, search, and return to.
            A world you own — not a feed you scroll.
          </p>
        </div>
      </section>

      <section className="lsec anon">
        <div className="anon-tag mono"><Ic name="eye-off" /> anonymous by construction</div>
        <h2 className="lsec-h">Anonymous to fund and make.</h2>
        <p className="lsec-sub">
          No email, no account trail. Deposit, join the anonymity set, and spend with a
          zero-knowledge proof — we never learn your wallet. Generation runs on external
          providers today; hardware-sealed compute (TEE) is on the roadmap.
        </p>
        <div className="docs">
          <Link className="btn-ghost" to="/about"><Ic name="file-text" /> Read the architecture</Link>
          <Link className="btn-ghost" to="/legal/privacy"><Ic name="eye-off" /> Privacy policy</Link>
        </div>
      </section>

      <section className="lsec priceteaser">
        <h2 className="lsec-h">Buy a pack. Spend it anywhere.</h2>
        <p className="lsec-sub">
          No subscription. Credits work across every model and tool, and they don't
          expire. Packs start at $10.
        </p>
        <div className="cta">
          <Link className="btn-ghost" to="/pricing">See pricing <Ic name="arrow-right" /></Link>
        </div>
      </section>

      <div className="endcta">
        <h2>Make something worth keeping.</h2>
        <Link className="btn lg" to="/onboard">Get started <Ic name="arrow-right" /></Link>
      </div>

      <SiteFooter />
    </div>
  );
}
