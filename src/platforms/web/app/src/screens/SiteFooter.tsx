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
          {/* The tagline states only what the privacy policy states. We never train on prompts or
              outputs, and an account needs no email — but run records are RETAINED, and erasure
              severs them from you rather than deleting them (privacy policy §5, §7, §8; MeEraser
              pseudonymizes and tombstones, it does not delete). "Kept until you erase your
              account" read as a deletion promise erasure does not keep, on every page of the
              site. It sits on every page; it is the widest claim we make. */}
          <div className="tag">Open-source generative media. An account needs no email, and we never train on your prompts or outputs. Run records are retained; erasing your account severs them from you rather than deleting them.</div>
        </div>
        <div className="col">
          <h3>Product</h3>
          <Link to="/features">Features</Link>
          <Link to="/pricing">Pricing</Link>
          <Link to="/catalog">Catalog</Link>
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
