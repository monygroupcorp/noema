import { Link } from 'react-router-dom';
import { useLandingCatalog } from './landingCatalog';
import './landing-open.css';

const REPO = 'https://github.com/monygroupcorp/noema';

/**
 * The open-source block, and the page's second live-derived one.
 *
 * The argument neither benchmark can make: the models are open weights, the code that runs them
 * is public, and anything that exists can be brought in. The endpoint count and the MCP route
 * are read from the served contract for the same reason the catalogue counts itself — a number
 * nobody typed cannot drift.
 *
 * Its device is a ticker of what is actually installed. It is real names moving, not decoration:
 * a marquee of invented words would be tacky, a marquee of the live catalogue is the argument.
 */
export function LandingOpen() {
  const { state, flows, models, api } = useLandingCatalog();
  if (state !== 'ready') return null;

  // One pass of the real catalogue, longest-lived first: the base models everything runs on,
  // then the workflows built over them.
  const ticker = [
    ...models.filter((m) => m.genus === 'model').map((m) => m.nomen),
    ...flows.map((f) => f.nomen).filter((n): n is string => !!n),
  ].filter(Boolean);
  if (ticker.length === 0) return null;

  return (
    <section className="lp-open">
      <div className="lp-open-in">
        <h2>If it exists, it can run here.</h2>
        <p>
          The models are open weights and the code that runs them is public. Bring one in by URL —
          a Civitai page, a Hugging Face repo, a bare <code>.safetensors</code> — and it works in
          every workflow the catalogue carries. Package something nobody has packaged yet, publish
          it, and it earns.
        </p>
        <div className="lp-open-facts">
          {api && (
            <div>
              <span className="n">{api.endpoints}</span>
              <span className="l">endpoints in the public contract</span>
            </div>
          )}
          {api?.mcp && (
            <div>
              <span className="n">MCP</span>
              <span className="l">so an agent can drive it too</span>
            </div>
          )}
          <div>
            {/* the licence is the repo's own: "VIRAL PUBLIC LICENSE — Copyleft (ɔ) All Rights
                Reversed". Not one of the SPDX names, so it is named as what it is rather than
                rounded to a familiar one. */}
            <span className="n">COPYLEFT</span>
            <span className="l">Viral Public License · the whole platform, in the open</span>
          </div>
        </div>
        <div className="lp-open-links">
          <a className="btn-ghost" href={REPO} target="_blank" rel="noreferrer">Read the source</a>
          <Link className="btn-ghost" to="/models">Import a model</Link>
        </div>
      </div>

      {/* the ticker — live names, moving slowly. Duplicated once so the loop has no seam. */}
      <div className="lp-open-ticker" aria-hidden="true">
        <div className="lp-open-rail">
          {[0, 1].map((pass) => (
            <ul key={pass}>
              {ticker.map((name, i) => (
                <li key={`${pass}-${i}`}>{name}</li>
              ))}
            </ul>
          ))}
        </div>
      </div>
      <p className="lp-open-ticker-alt">
        Everything above is a model or workflow currently installed, read from the catalogue.
      </p>
    </section>
  );
}
