import { Link, useParams } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { SiteFooter } from './SiteFooter';
import { entryPath } from '../lib/entry';
import { POSTS, postBySlug } from './blogPosts';
import './landing.css';
import './doc.css';
import './blog.css';

function Chrome({ children }: { children: React.ReactNode }) {
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
      {children}
      <SiteFooter />
    </div>
  );
}

/** The guide index. Empty until guides land, and honest about it — the same register the app
 *  uses everywhere else it has nothing to show yet. */
export function Blog() {
  return (
    <Chrome>
      <article className="prose">
        <h1>Guides</h1>
        {POSTS.length === 0 ? (
          <p className="blog-empty">
            Nothing published yet. Guides to training a model, composing a workflow and running
            noema over the API land here first — in the meantime the{' '}
            <Link to="/catalog">catalogue</Link> is the fastest way in.
          </p>
        ) : (
          <ul className="blog-index">
            {POSTS.map((p) => (
              <li key={p.slug}>
                <Link to={`/blog/${p.slug}`}>
                  <span className="blog-title">{p.title}</span>
                  {p.blurb && <span className="blog-blurb">{p.blurb}</span>}
                </Link>
                {p.published && <time className="blog-date mono">{p.published}</time>}
              </li>
            ))}
          </ul>
        )}
      </article>
    </Chrome>
  );
}

/** One guide. An unknown slug says so and offers the index, rather than rendering blank. */
export function BlogPost() {
  const { slug } = useParams<{ slug: string }>();
  const post = slug ? postBySlug(slug) : undefined;
  return (
    <Chrome>
      <article className="prose">
        {post ? (
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{post.body}</ReactMarkdown>
        ) : (
          <>
            <h1>No such guide</h1>
            <p className="blog-empty">
              That guide does not exist — it may have been renamed.{' '}
              <Link to="/blog">All guides</Link>.
            </p>
          </>
        )}
      </article>
    </Chrome>
  );
}
