import { lazy, Suspense, type ReactNode } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { Chat } from './screens/Chat';
import { Card } from './screens/Card';
import { Catalog } from './screens/Catalog';
import { Status } from './screens/Status';
import { Keyring } from './screens/Keyring';
import { Profile } from './screens/Profile';
import { Funding } from './screens/Funding';
// Space (three.js), Canvas (React Flow) and Vault (circomlibjs/snarkjs ZK) are heavy —
// lazy-load so they only ship on open.
const Space = lazy(() => import('./screens/Space').then((m) => ({ default: m.Space })));
const Canvas = lazy(() => import('./screens/Canvas').then((m) => ({ default: m.Canvas })));
const Vault = lazy(() => import('./screens/Vault').then((m) => ({ default: m.Vault })));
const lazyEl = (node: ReactNode) => <Suspense fallback={<div className="page"><div className="pw"><div className="empty"><div className="t">Loading…</div></div></div></div>}>{node}</Suspense>;
// Coded design laboratory for the landing redesign (STANDARD §7.2). The plate slots it renders
// are unfilled placeholders, and an unfinished slot must never be able to reach a visitor — so
// the import itself is behind the dev flag, not just the route. With DEV false this collapses to
// `null`, the dynamic import is unreachable, and neither the component nor its stylesheet is
// emitted into the production build.
const PlateLab = import.meta.env.DEV
  ? lazy(() => import('./screens/PlateLab').then((m) => ({ default: m.PlateLab })))
  : null;
import { Projects } from './screens/Projects';
import { Dashboard } from './screens/Dashboard';
import { ProjectHub } from './screens/ProjectHub';
import { Datasets } from './screens/Datasets';
import { Dataset } from './screens/Dataset';
import { CaptionJob } from './screens/CaptionJob';
import { Derive } from './screens/Derive';
import { Muse, MuseSessions } from './screens/Muse';
import { TrainRun } from './screens/TrainRun';
import { Shelf } from './screens/Shelf';
import { Teams } from './screens/Teams';
import { Sponsorships } from './screens/Sponsorships';
import { AccountSettings } from './screens/AccountSettings';
import { Preferences } from './screens/Preferences';
import { Collections } from './screens/Collections';
import { EditioHub } from './screens/EditioHub';
import { TraitsGarden } from './screens/TraitsGarden';
import { TraitRules } from './screens/TraitRules';
import { CanonicRun } from './screens/CanonicRun';
import { Curation } from './screens/Curation';
import { EditioExport } from './screens/EditioExport';
import { Run } from './screens/Run';
import { Studio } from './screens/Studio';
import { Onboard } from './screens/Onboard';
import { Landing } from './screens/Landing';
import { Ceremony } from './screens/Ceremony';
import { Feed } from './screens/Feed';
import { Review } from './screens/Review';
import { AdminWorkspace } from './screens/AdminWorkspace';
import { Doc } from './screens/Doc';
import { Blog, BlogPost } from './screens/Blog';
import { Pricing } from './screens/Pricing';
import { Stub } from './screens/Stub';
import aboutMd from './content/about.md?raw';
import featuresMd from './content/features.md?raw';
import privacyMd from './content/privacy.md?raw';
import cookiesMd from './content/cookies.md?raw';
import termsMd from './content/terms.md?raw';

export function App() {
  return (
    <Routes>
      {/* Marketing Landing owns the root; the app shell's Home/dashboard is /app. */}
      <Route path="/" element={<Landing />} />
      <Route path="/app" element={<Dashboard />} />
      <Route path="/chat" element={<Chat />} />
      <Route path="/datasets" element={<Datasets />} />
      <Route path="/datasets/:id" element={<Dataset />} />
      <Route path="/datasets/:id/caption" element={<CaptionJob />} />
      <Route path="/datasets/:id/derive" element={<Derive />} />
      <Route path="/datasets/:id/muse" element={<Muse />} />
      {/* The sessions broken off a dataset (noema-274). The bare muse route above still
          means "resume the most recently worked session"; one specific session is named
          on it as `?session=<id>`, which leaves that existing meaning — and every link
          and bookmark carrying it — untouched. */}
      <Route path="/datasets/:id/muse/sessions" element={<MuseSessions />} />
      <Route path="/train/run/:id" element={<TrainRun />} />
      <Route path="/models" element={<Shelf />} />
      <Route path="/teams" element={<Teams />} />
      <Route path="/sponsorships" element={<Sponsorships />} />
      <Route path="/collections" element={<Collections />} />
      <Route path="/collections/:id" element={<EditioHub />} />
      <Route path="/collections/:id/garden" element={<TraitsGarden />} />
      <Route path="/collections/:id/rules" element={<TraitRules />} />
      <Route path="/collections/:id/run" element={<CanonicRun />} />
      <Route path="/collections/:id/curation" element={<Curation />} />
      <Route path="/collections/:id/export" element={<EditioExport />} />
      <Route path="/card" element={<Card />} />
      <Route path="/catalog" element={<Catalog />} />
      <Route path="/feed" element={<Feed />} />
      {/* Moderation held-queue (publishing spec §4). /review was the author-facing home; its
          pending-items UI is now a conditional section on Feed itself (noema-075), so /review is
          just a redirect. /admin/review (the moderation queue: approve/reject/confirm-csam,
          me.admin-gated, server-enforced regardless) is unaffected. */}
      <Route path="/review" element={<Navigate to="/feed" replace />} />
      <Route path="/admin/review" element={<Review />} />
      {/* Admin workspace hub (noema-011): links the review queue + read-only revenue/COGS
          cards. me.admin-gated client-side; every report re-gates server-side regardless. */}
      <Route path="/admin" element={<AdminWorkspace />} />
      <Route path="/projects" element={<Projects />} />
      <Route path="/projects/:id" element={<ProjectHub />} />
      <Route path="/run" element={<Run />} />
      <Route path="/canvas" element={lazyEl(<Canvas />)} />
      <Route path="/space" element={lazyEl(<Space />)} />
      <Route path="/keyring" element={<Keyring />} />
      <Route path="/vault" element={lazyEl(<Vault />)} />
      <Route path="/profile" element={<Profile />} />
      <Route path="/status" element={<Status />} />
      <Route path="/account" element={<AccountSettings />} />
      <Route path="/account/:section" element={<AccountSettings />} />
      <Route path="/preferences" element={<Preferences />} />
      <Route path="/funding" element={<Funding />} />
      <Route path="/studio" element={<Studio />} />
      <Route path="/onboard" element={<Onboard />} />
      <Route path="/landing" element={<Landing />} />
      {PlateLab && <Route path="/lab/landing" element={lazyEl(<PlateLab />)} />}
      <Route path="/ceremony" element={<Ceremony />} />
      {/* Fiat auth — sign-in / create lives inline in Door A (/onboard). No email, so
          no verify/reset token pages; recovery is via backup channels bound in the profile. */}
      <Route path="/about" element={<Doc md={aboutMd} />} />
      <Route path="/features" element={<Doc md={featuresMd} />} />
      <Route path="/pricing" element={<Pricing />} />
      <Route path="/blog" element={<Blog />} />
      <Route path="/blog/:slug" element={<BlogPost />} />
      <Route path="/legal/privacy" element={<Doc md={privacyMd} />} />
      <Route path="/legal/cookies" element={<Doc md={cookiesMd} />} />
      <Route path="/legal/terms" element={<Doc md={termsMd} />} />
      <Route path="*" element={<Stub crumb="404" title="Not found" />} />
    </Routes>
  );
}
