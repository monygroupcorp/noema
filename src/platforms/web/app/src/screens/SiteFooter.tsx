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
              outputs, and an account needs no email — but run records ARE kept until erasure, so
              this must not say otherwise. It sits on every page; it is the widest claim we make. */}
          <div className="tag">Open-source generative media. An account needs no email, and we never train on your prompts or outputs. Your runs are kept for you until you erase your account.</div>
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
      <div className="legal">© 2026 noema · privacy by construction</div>
    </footer>
  );
}
