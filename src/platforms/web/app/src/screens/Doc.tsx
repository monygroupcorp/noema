import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Link } from 'react-router-dom';
import { SiteFooter } from './SiteFooter';
import './landing.css'; // reuse .topnav / .btn chrome
import './doc.css';

// Generic markdown content page (about / features / pricing / blog / legal/*).
export function Doc({ md }: { md: string }) {
  return (
    <div className="doc-page">
      <nav className="topnav">
        <Link to="/landing" className="brand" style={{ textDecoration: 'none', color: 'inherit' }}>
          <span className="dot" />noema
        </Link>
        <div className="right">
          <Link className="btn-ghost" to="/features">Features</Link>
          <Link className="btn-ghost" to="/pricing">Pricing</Link>
          <Link className="btn" to="/">Open app</Link>
        </div>
      </nav>
      <article className="prose">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{md}</ReactMarkdown>
      </article>
      <SiteFooter />
    </div>
  );
}
