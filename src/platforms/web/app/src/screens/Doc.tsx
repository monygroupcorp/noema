import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Link } from 'react-router-dom';
import { SiteFooter } from './SiteFooter';
import { entryPath } from '../lib/entry';
import './landing.css'; // reuse .topnav / .btn chrome
import './doc.css';

// A table wider than a phone scrolls sideways inside its own container instead of being
// clipped at the page edge (REFERENCES.md REF-3: long prose a reader finishes on any width).
// The table itself keeps real table layout, so its columns stay readable and aligned.
const components: Components = {
  table: ({ node, ...props }) => <div className="table-wrap"><table {...props} /></div>,
};

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
          <Link className="btn" to={entryPath()}>Open app</Link>
        </div>
      </nav>
      <article className="prose">
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>{md}</ReactMarkdown>
      </article>
      <SiteFooter />
    </div>
  );
}
