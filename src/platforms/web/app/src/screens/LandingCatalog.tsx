import { Link } from 'react-router-dom';
import { useLandingCatalog } from './landingCatalog';
import './landing-catalog.css';

const KIND_LABEL: Record<string, string> = {
  model: 'base models',
  lora: 'trained identities',
  embedding: 'encoders',
};

/**
 * The breadth block, read from the live catalogue.
 *
 * Every number here is counted from the same endpoints the product runs on, so the page cannot
 * overstate what noema carries and it grows on its own as work ships. When the catalogue cannot
 * be reached the block renders nothing at all: an unreachable catalogue is not a small
 * catalogue, and a marketing surface has no business guessing.
 */
export function LandingCatalog() {
  const { state, summary, flows } = useLandingCatalog();

  if (state === 'error') return null;
  if (state === 'loading' || !summary) {
    return <section className="lp-cat" aria-busy="true"><div className="lp-cat-in lp-cat-wait" /></section>;
  }

  // The workflow list is a sample, not an inventory — the catalogue carries more than a landing
  // page should print, and the counts above already carry the breadth.
  const named = flows.filter((f) => f.nomen).slice(0, 12);

  return (
    <section className="lp-cat">
      <div className="lp-cat-in">
        <h2>Under the hood</h2>
        <p className="lp-cat-sub">
          Check back and watch the platform grow, as we keep adding cutting-edge advances in
          open generative AI and training our own models. Counted from the catalogue when this
          page loads, never written into it.
        </p>

      </div>

      {/* The one moment on the page that raises its voice. These are the numbers the platform
          actually earned, and whispering them at body scale was the page's own fault. */}
      <dl className="lp-cat-brag">
        <div><dt>{summary.loras}</dt><dd>identities trained here</dd></div>
        <div><dt>{summary.workflows}</dt><dd>workflows to run them through</dd></div>
      </dl>

      <div className="lp-cat-in">

        <div className="lp-cat-cols">
          <div className="lp-cat-col">
            <h3 className="mono">by modality</h3>
            <ul className="lp-cat-bars">
              {summary.modalities.map((m) => (
                <li key={m.key}>
                  <span className="k">{m.key}</span>
                  <span className="bar" style={{ '--w': `${(m.count / summary.modalities[0].count) * 100}%` } as React.CSSProperties} />
                  <span className="n mono">{m.count}</span>
                </li>
              ))}
            </ul>
            <h3 className="mono">what they do</h3>
            <ul className="lp-cat-chips">
              {summary.verbs.map((v) => (
                <li key={v.key}>{v.key} <span className="mono">{v.count}</span></li>
              ))}
            </ul>
          </div>

          <div className="lp-cat-col">
            <h3 className="mono">models installed</h3>
            <ul className="lp-cat-bars">
              {summary.kinds.map((k) => (
                <li key={k.key}>
                  <span className="k">{KIND_LABEL[k.key] ?? k.key}</span>
                  <span className="bar" style={{ '--w': `${(k.count / summary.kinds[0].count) * 100}%` } as React.CSSProperties} />
                  <span className="n mono">{k.count}</span>
                </li>
              ))}
            </ul>
            {summary.bases.length > 0 && (
              <>
                <h3 className="mono">what they are trained on</h3>
                <ul className="lp-cat-bars">
                  {summary.bases.map((b) => (
                    <li key={b.key}>
                      <span className="k">{b.key}</span>
                      <span className="bar" style={{ '--w': `${(b.count / summary.bases[0].count) * 100}%` } as React.CSSProperties} />
                      <span className="n mono">{b.count}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        </div>

        <h3 className="mono lp-cat-h">the catalogue</h3>
        <ul className="lp-cat-list lp-cat-flows">
          {named.map((f) => <li key={f.id}>{f.nomen}</li>)}
        </ul>
        <Link className="btn-ghost" to="/catalog">See all {summary.workflows} workflows</Link>
      </div>
    </section>
  );
}
