import { Link } from 'react-router-dom';
import { AppShell } from '../shell/AppShell';

interface Card { title: string; phase: string; desc: string; to: string }

const SHELL_ENTRY: Card[] = [
  { title: 'Landing',    phase: 'mkt', desc: 'Public marketing — the reserved pitch.',                                              to: '/landing' },
  { title: 'Onboarding', phase: 'P1',  desc: 'First run — pick an entry, create your first identity, choose its trust tier.',       to: '/onboard' },
];

const CREATE: Card[] = [
  { title: 'Chat / Concierge', phase: 'P1', desc: 'The front door. Intent → verb → streamed result.',     to: '/' },
  { title: 'Flow card',        phase: 'P1', desc: 'One tool as a form: inputs, quote, run, result.',       to: '/card' },
  { title: 'Catalog',          phase: 'P1', desc: 'Discover runnable flows; feeds the card.',              to: '/catalog' },
  { title: 'Run detail',       phase: 'P1', desc: 'A run in flight — staged timeline → outputs.',          to: '/run' },
  { title: 'Canvas',           phase: 'P3', desc: 'Accumulated runs wired into a spell.',                  to: '/canvas' },
];

const MEMORY: Card[] = [
  { title: '3D creation space', phase: 'P2', desc: 'Fly your past generations — cluster, search, cultivate.',          to: '/space' },
  { title: 'Trace detail',      phase: 'P2', desc: 'One creation: lineage, reactions, save → spell / dataset.',        to: '/trace' },
];

const IDENTITY: Card[] = [
  { title: 'Keyring',        phase: 'P0',   desc: 'Manage & switch identities; create new at a chosen tier.',            to: '/keyring' },
  { title: 'Vault',          phase: 'P2.5', desc: 'Secrets, recovery phrase, purse, fund, export/import.',               to: '/vault' },
  { title: 'Profile / skins', phase: 'P1',  desc: 'Skins, BYO assets, optional generated kit.',                         to: '/profile' },
  { title: 'Private session', phase: 'P5',  desc: 'Provision the sealed pod; tunnel status; the redaction view.',        to: '/tee' },
];

const ACCOUNT: Card[] = [
  { title: 'Account / ledger', phase: 'P1',    desc: 'Credits balance, spend, quote history.',  to: '/status' },
  { title: 'Studio',           phase: 'later',  desc: 'Warm pod session; metered HUD.',          to: '/studio' },
];

function MapGrid({ cards }: { cards: Card[] }) {
  return (
    <div className="mapgrid">
      {cards.map((c) => (
        <Link key={c.to + c.title} className="mapcard" to={c.to}>
          <div className="mt">{c.title} <span className="ph">{c.phase}</span></div>
          <div className="md">{c.desc}</div>
        </Link>
      ))}
    </div>
  );
}

export function Map() {
  return (
    <AppShell crumb="map">
      <div className="page"><div className="pw wide">
        <div className="pagehead">
          <div>
            <h1>The map</h1>
            <div className="sub">Every screen in the application — one coherent reference. Click any to open its screen.</div>
          </div>
        </div>

        <div className="sectionhead">Shell &amp; entry</div>
        <MapGrid cards={SHELL_ENTRY} />

        <div className="sectionhead">Create axis</div>
        <MapGrid cards={CREATE} />

        <div className="sectionhead">Memory axis</div>
        <MapGrid cards={MEMORY} />

        <div className="sectionhead">Identity · vault · privacy</div>
        <MapGrid cards={IDENTITY} />

        <div className="sectionhead">Account</div>
        <MapGrid cards={ACCOUNT} />
      </div></div>
    </AppShell>
  );
}
