import { Link } from 'react-router-dom';
import './site-footer.css';

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="inner">
        <div>
          <div className="brand"><span className="dot" />noema</div>
          <div className="tag">Make anything. We never have to see it. Open-source, privacy-by-construction generative media.</div>
        </div>
        <div className="col">
          <h4>Product</h4>
          <Link to="/features">Features</Link>
          <Link to="/pricing">Pricing</Link>
          <Link to="/catalog">Catalog</Link>
          <Link to="/">Open app</Link>
        </div>
        <div className="col">
          <h4>Company</h4>
          <Link to="/about">About</Link>
          <Link to="/blog">Blog</Link>
          <a href="#">Source · VPL</a>
        </div>
        <div className="col">
          <h4>Legal</h4>
          <Link to="/legal/privacy">Privacy</Link>
          <Link to="/legal/cookies">Cookies</Link>
          <Link to="/legal/terms">Terms</Link>
        </div>
      </div>
      <div className="legal">© 2026 noema · privacy by construction</div>
    </footer>
  );
}
