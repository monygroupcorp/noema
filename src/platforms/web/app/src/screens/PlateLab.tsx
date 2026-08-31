import { LandingPlate } from './LandingPlate';
import { PLATES, isPlaceholder, platesIn } from './landingPlates';
import './plate-lab.css';

/**
 * The coded design laboratory for the landing page's plate slots.
 *
 * Not a public surface: the route is registered only in dev builds, so unfilled slots cannot
 * reach a visitor. It exists so the reserved geometry can be looked at in the real
 * application — real fonts, real tokens, real responsive behaviour — at the widths the
 * capability proof is judged at (1440 and 390). Resize the window, or point the route walk
 * harness at a dev server, to capture both.
 */
export function PlateLab() {
  const filled = PLATES.filter((s) => !isPlaceholder(s)).length;

  return (
    <div className="plate-lab">
      <header className="lab-head">
        <h1>Landing plate slots</h1>
        <p>
          The reserved geometry of the landing page's imagery, with no art in it yet. Every box
          below holds the exact aspect ratio its finished plate will fill, so the layout measured
          here is the layout the plates land into.
        </p>
        <p className="lab-count mono">
          {filled} of {PLATES.length} slots filled · swap point: src/screens/landingPlates.ts
        </p>
      </header>

      <section className="lab-sec">
        <h2>Hero — 3:2</h2>
        <p className="lab-note">One plate, held still and alone. The settle motion is applied here
          and nowhere else; it is suppressed under <code>prefers-reduced-motion: reduce</code>.</p>
        <div className="lab-hero">
          {platesIn('hero').map((slot) => (
            <LandingPlate key={slot.id} slot={slot} priority resolve />
          ))}
        </div>
      </section>

      <section className="lab-sec">
        <h2>Cross-subject row — 4:5</h2>
        <p className="lab-note">One plate per subject class. The claim these three make together
          is that the identity is the look, so they are filled as a set or not at all.</p>
        <div className="lab-row">
          {platesIn('cross-subject').map((slot) => (
            <LandingPlate key={slot.id} slot={slot} />
          ))}
        </div>
      </section>

      <section className="lab-sec">
        <h2>Collection grid — 1:1</h2>
        <p className="lab-note">Tile size is the silhouette test: a plate that only works at 1440
          fails here.</p>
        <div className="lab-grid">
          {platesIn('collection').map((slot) => (
            <LandingPlate key={slot.id} slot={slot} />
          ))}
        </div>
      </section>

      <section className="lab-sec">
        <h2>Narrow column — 390</h2>
        <p className="lab-note">The same slots constrained to the mobile width, on any viewport.
          A plate is not finished until its narrow crop is a composition rather than a squeeze.</p>
        <div className="lab-narrow">
          {platesIn('hero').map((slot) => (
            <LandingPlate key={slot.id} slot={slot} />
          ))}
          <div className="lab-grid narrow">
            {platesIn('collection').slice(0, 4).map((slot) => (
              <LandingPlate key={slot.id} slot={slot} />
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
