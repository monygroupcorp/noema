import { Link } from 'react-router-dom';
import { Ic } from '../lib/icons';
import { SiteFooter } from './SiteFooter';
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

const BACK_HALF_NODES = [
  {
    id: 'device',
    icon: 'laptop',
    title: 'Your device',
    items: [
      { text: 'WireGuard keypair generated in-browser' },
      { text: 'private key never leaves the device' },
      { text: 'prompts & results live only here' },
    ],
  },
  {
    id: 'pod',
    icon: 'server',
    title: 'Sealed GPU pod',
    items: [
      { text: 'confidential compute — SEV-SNP / TDX' },
      { text: 'your model runs inside the enclave' },
      { text: 'pod terminates · nothing persisted', mono: true },
    ],
  },
];

const FEATURES = [
  {
    id: 'intent',
    icon: 'sparkles',
    title: 'Intent in, work out',
    desc: 'Describe what you want. A concierge picks the tools and runs them. Open the controls only when you care to.',
  },
  {
    id: 'place',
    icon: 'sparkles',
    title: 'Your work becomes a place',
    desc: 'Every creation lands in a space you fly through, search, and return to. A world you own — not a feed you scroll.',
  },
  {
    id: 'privacy',
    icon: 'eye-off',
    title: 'Privacy you can verify',
    desc: 'Run sealed in private compute and we receive only the bill. The interface shows you, plainly, what we can\'t see.',
  },
];

export function Landing() {
  return (
    <div className="landing-page">
      <nav className="topnav">
        <div className="brand"><svg className="dot" viewBox="0 0 24 24" aria-hidden="true"><path className="lit" d="M12,2 A10 10 0 0 0 12,22 Z" /><circle className="ring" cx="12" cy="12" r="10" fill="none" strokeWidth="1.4" /></svg>noema</div>
        <div className="right">
          <Link className="btn-ghost" to="/features">Features</Link>
          <Link className="btn-ghost" to="/pricing">Pricing</Link>
          <Link className="btn-ghost" to="/about">About</Link>
          <Link className="btn" to="/">Open app</Link>
        </div>
      </nav>

      <div className="hero">
        <div className="eyebrow">Generative studio</div>
        <h1>Make anything.<br />We never have to see it.</h1>
        <p className="lead">
          A studio for generative media — images, video, 3D, sound. Run our models or
          your own. Stay signed in, go anonymous, or seal your work in private compute we are{' '}
          <em>architecturally</em> unable to read.
        </p>
        <div className="cta">
          <Link className="btn lg" to="/onboard">Start free <Ic name="arrow-right" /></Link>
          <Link className="btn-ghost" to="/">See it work</Link>
        </div>
        <div className="proof">no email to start · pay anonymously · go fully private anytime</div>
      </div>

      <div className="stance">
        <div className="in">
          <h2>
            Every other AI studio can read everything you make.<br />
            <span className="dim">We built one that can prove it doesn't.</span>
          </h2>
          <div className="sub">
            Go private and only the meter reaches us — never your prompts, never your results.
            We show you exactly what we receive: nothing.
          </div>
        </div>
      </div>

      <section className="arch">
        <div className="lab">How private compute works</div>
        <h2>The architecture is the guarantee.</h2>
        <p className="ah-sub">
          Two halves of one promise — fund anonymously, compute privately. Not a policy you
          trust; a path we're built not to take. The whole mechanism, in the open.
        </p>

        <div className="lane">
          <div className="lanehead">
            <span className="n">front half</span>
            {' '}Anonymous credit{' '}
            <span className="lt">— pay without being identified</span>
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

        <div className="lane">
          <div className="lanehead">
            <span className="n">back half</span>
            {' '}Private compute{' '}
            <span className="lt">— work without being seen</span>
          </div>
          <div className="diagram">
            {BACK_HALF_NODES.map((node, i) => (
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
                {i < BACK_HALF_NODES.length - 1 && (
                  <div key={`arrow-${i}`} className="darrow">
                    <Ic name="arrow-right" />
                    <span className="m">encrypted tunnel</span>
                  </div>
                )}
              </>
            ))}
          </div>
        </div>

        <div className="meter">
          <div className="ml">what reaches noema</div>
          <div className="redact mono">
            <div className="row"><span className="k">who</span><span className="v block">▮▮▮▮▮▮</span></div>
            <div className="row"><span className="k">prompt</span><span className="v block">▮▮▮▮▮▮▮▮▮▮</span></div>
            <div className="row"><span className="k">result</span><span className="v block">▮▮▮▮▮▮</span></div>
            <div className="row"><span className="k">cost</span><span className="v">$0.043 · 12 GPU-min</span></div>
          </div>
          <div className="mn">Session opened, minutes metered, session closed. That is the entire record.</div>
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
        <h2>Make something only you will ever see.</h2>
        <Link className="btn lg" to="/onboard">Start free <Ic name="arrow-right" /></Link>
      </div>

      <SiteFooter />
    </div>
  );
}
