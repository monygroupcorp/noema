import { Link } from 'react-router-dom';
import { entryPath } from '../lib/entry';
import './site-footer.css';

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="inner">
        <div>
          <div className="brand"><span className="dot" />noema</div>
          <div className="tag">Make anything, anonymously. Open-source generative media — no prompt or output retention, no training on your work.</div>
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
          <a href="#">Source · VPL</a>
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
