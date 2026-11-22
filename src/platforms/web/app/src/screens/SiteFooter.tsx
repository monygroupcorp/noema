import { Link } from 'react-router-dom';
import { entryPath } from '../lib/entry';
import { REPO } from '../lib/repo';
import './site-footer.css';

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="inner">
        <div>
          <div className="brand"><span className="dot" />noema</div>
          {/* The tagline makes no product claim. The privacy policy owns what is kept, what is
              never done with it, and what erasure does (it severs, it does not delete — §7, §8),
              and a claim is stated once, in the place that owns it (DESIGN.md P-1b, D-71). This
              strip sits on every page: restating the policy here put the widest claim we make
              under every screen, and it drifted from the policy once already ("kept until you
              erase your account" read as a deletion promise erasure does not keep). */}
          <div className="tag">Open-source generative media. <Link to="/legal/privacy">What is kept, and why</Link>.</div>
        </div>
        <div className="col">
          <h3>Product</h3>
          <Link to="/features">Features</Link>
          <Link to="/pricing">Pricing</Link>
          <Link to="/catalog">Catalogue</Link>
          <Link to={entryPath()}>Open app</Link>
        </div>
        <div className="col">
          <h3>Company</h3>
          <Link to="/about">About</Link>
          <Link to="/ceremony">Ceremony</Link>
          <Link to="/blog">Guides</Link>
          <Link to="/partners">Partner with us</Link>
          <a href={REPO} target="_blank" rel="noreferrer">Source · VPL</a>
        </div>
        <div className="col">
          <h3>Legal</h3>
          <Link to="/legal/privacy">Privacy</Link>
          <Link to="/legal/cookies">Cookies</Link>
          <Link to="/legal/terms">Terms</Link>
        </div>
      </div>
      {/* This strip used to claim privacy as a structural property of the system, on every page.
          That is the absolute `npm run guard:claims` exists to deny, and it escaped only because
          the denylist spelled the phrase hyphenated and this said it with spaces. We do not have
          it: inference runs on plaintext on GPUs we operate, and the privacy policy says so. What
          we do have is the distinction /pricing and /funding already draw. */}
      <div className="legal">© 2026 noema · anonymity, not invisibility</div>
    </footer>
  );
}
