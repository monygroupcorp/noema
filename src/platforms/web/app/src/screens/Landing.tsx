import { Link } from 'react-router-dom';
import { Ic } from '../lib/icons';
import { SiteFooter } from './SiteFooter';
import { entryPath } from '../lib/entry';
import { Wordmark } from '../ui/Wordmark';
import './landing.css';

const FRONT_HALF_NODES = [
  {
    id: 'wallet',
    icon: 'wallet',
    title: 'Your wallet',
    items: [
      { text: 'deposit ETH or tokens' },
      { text: 'a note is generated in your browser' },
      { text: 'nullifier + secret — never shared', mono: true },
    ],
  },
  {
    id: 'anon-set',
    icon: 'shuffle',
    title: 'Anonymity set',
    items: [
      { text: 'a Tornado-style Merkle set' },
      { text: 'your deposit joins the crowd' },
      { text: 'wallet ⇸ note link severed', mono: true },
    ],
  },
  {
    id: 'funded',
    icon: 'coins',
    title: 'Funded account',
    items: [
      { text: 'spend with a zero-knowledge proof' },
      { text: 'credits with no trace to you' },
      { text: 'we never learn your wallet', mono: true },
    ],
  },
];

const FEATURES = [
  {
    id: 'intent',
    icon: 'wand-sparkles',
    title: 'Intent in, work out',
    desc: 'Describe what you want. A concierge picks the tools and runs them. Open the controls only when you care to.',
  },
  {
    id: 'models',
    icon: 'sparkles',
    title: 'Curated models, open and closed',
    desc: 'A hand-picked set of open- and closed-source models — or bring your own endpoint. Swap between them without swapping tools.',
  },
  {
    id: 'place',
    icon: 'sparkles',
    title: 'Your work becomes a place',
    desc: 'Every creation lands in a space you fly through, search, and return to. A world you own — not a feed you scroll.',
  },
  {
    id: 'anon',
    icon: 'eye-off',
    title: 'Anonymous to fund and make',
    desc: 'No email. Fund with a zero-knowledge proof — we never learn your wallet, and there is no account trail behind your work.',
  },
];

export function Landing() {
  return (
    <div className="landing-page">
      <nav className="topnav">
        <Link to="/" className="brand" aria-label="noema home"><Wordmark height={22} /></Link>
        <div className="right">
          <Link className="btn-ghost" to="/features">Features</Link>
          <Link className="btn-ghost" to="/pricing">Pricing</Link>
          <Link className="btn-ghost" to="/ceremony">Ceremony</Link>
          <Link className="btn" to={entryPath()}>Open app</Link>
        </div>
      </nav>

      <div className="hero">
        <span className="noema-glow hero-glow" aria-hidden="true" />
        <div className="noema-kicker hero-kicker">Boutique generative AI · Studio + concierge</div>
        <h1 className="hero-display">A complete studio.<br /><span className="accent">A concierge that builds with you.</span></h1>
        <hr className="noema-rule hero-rule" />
        <p className="lead">Curated open- and closed-source models. Describe what you want — a concierge picks the tools and makes it.</p>
        <div className="cta">
          <Link className="btn lg" to="/onboard">Start free <Ic name="arrow-right" /></Link>
          <Link className="btn-ghost" to={entryPath()}>See it work</Link>
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
            there when you want them — never in your way when you don't.
          </div>
        </div>
      </div>

      <section className="arch">
        <div className="lab">How anonymous funding works</div>
        <h2>Anonymous by construction.</h2>
        <p className="ah-sub">
          We don't need to know who you are. Deposit, join the anonymity set, and spend with a
          zero-knowledge proof — we never learn your wallet. This is about <em>who</em> you are,
          not a claim that a compute provider can't see your work.
        </p>

        <div className="lane">
          <div className="lanehead">
            <span className="n">anonymous credit</span>
            {' '}Pay without being identified
          </div>
          <div className="diagram three">
            {FRONT_HALF_NODES.map((node, i) => (
              <>
                <div key={node.id} className="dnode">
                  <div className="dt">
                    <span className="li"><Ic name={node.icon} /></span>
                    {node.title}
                  </div>
                  <ul>
                    {node.items.map((item, j) => (
                      <li key={j} className={item.mono ? 'm' : undefined}>{item.text}</li>
                    ))}
                  </ul>
                </div>
                {i < FRONT_HALF_NODES.length - 1 && (
                  <div key={`arrow-${i}`} className="darrow">
                    <Ic name="arrow-right" />
                    <span className="m">{i === 0 ? 'deposit' : 'ZK proof'}</span>
                  </div>
                )}
              </>
            ))}
          </div>
        </div>

        <div className="meter">
          <div className="ml">what we learn about you</div>
          <div className="redact mono">
            <div className="row"><span className="k">who</span><span className="v block">▮▮▮▮▮▮</span></div>
            <div className="row"><span className="k">wallet</span><span className="v block">▮▮▮▮▮▮▮▮▮▮</span></div>
            <div className="row"><span className="k">account</span><span className="v">none — no email, no login</span></div>
          </div>
          <div className="mn">
            Your identity and funding are severed from your work. Generation and concierge
            reasoning run on external providers (RunPod GPUs, an LLM provider) — we don't
            claim they can't see session content. Hardware-isolated private compute is in development.
          </div>
        </div>

        <div className="docs">
          <Link className="btn-ghost" to="/about"><Ic name="file-text" /> Read the architecture</Link>
          <Link className="btn-ghost" to="/legal/privacy"><Ic name="eye-off" /> Privacy policy</Link>
          <a className="btn-ghost" href="#"><Ic name="file-text" /> Source — VPL licensed</a>
        </div>
      </section>

      <div className="lfeat">
        {FEATURES.map((feat) => (
          <div key={feat.id} className="lf">
            <div className="li"><Ic name={feat.icon} /></div>
            <h3>{feat.title}</h3>
            <p>{feat.desc}</p>
          </div>
        ))}
      </div>

      <div className="endcta">
        <h2>Make something worth keeping.</h2>
        <Link className="btn lg" to="/onboard">Start free <Ic name="arrow-right" /></Link>
      </div>

      <SiteFooter />
    </div>
  );
}
