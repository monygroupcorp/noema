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
    return <section className="cat" aria-busy="true"><div className="cat-in cat-wait" /></section>;
  }

  // The workflow list is a sample, not an inventory — the catalogue carries more than a landing
  // page should print, and the counts above already carry the breadth.
  const named = flows.filter((f) => f.nomen).slice(0, 12);

  return (
    <section className="cat">
      <div className="cat-in">
        <h2>Everything the studio carries — counted, not claimed.</h2>
        <p className="cat-sub">
          These numbers are read from the catalogue when the page loads, not written into it.
          They move when we ship.
        </p>

        <dl className="cat-stats">
          <div><dt>{summary.workflows}</dt><dd>workflows</dd></div>
          <div><dt>{summary.verbs.length}</dt><dd>things they do</dd></div>
          <div><dt>{summary.modalities.length}</dt><dd>modalities</dd></div>
          <div><dt>{summary.models}</dt><dd>models on the shelf</dd></div>
          <div><dt>{summary.loras}</dt><dd>trained identities</dd></div>
        </dl>

        <div className="cat-cols">
          <div className="cat-col">
            <h3 className="mono">by modality</h3>
            <ul className="cat-bars">
              {summary.modalities.map((m) => (
                <li key={m.key}>
                  <span className="k">{m.key}</span>
                  <span className="bar" style={{ '--w': `${(m.count / summary.modalities[0].count) * 100}%` } as React.CSSProperties} />
                  <span className="n mono">{m.count}</span>
                </li>
              ))}
            </ul>
            <h3 className="mono">what they do</h3>
            <ul className="cat-chips">
              {summary.verbs.map((v) => (
                <li key={v.key}>{v.key} <span className="mono">{v.count}</span></li>
              ))}
            </ul>
          </div>

          <div className="cat-col">
            <h3 className="mono">on the shelf</h3>
            <ul className="cat-bars">
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
                <ul className="cat-bars">
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

        <h3 className="mono cat-h">the catalogue</h3>
        <ul className="cat-list cat-flows">
          {named.map((f) => <li key={f.id}>{f.nomen}</li>)}
        </ul>
        <Link className="btn-ghost" to="/catalog">See all {summary.workflows} workflows</Link>
      </div>
    </section>
  );
}
