import { lazy, Suspense, type ReactNode } from 'react';
import { Routes, Route } from 'react-router-dom';
import { Chat } from './screens/Chat';
import { Card } from './screens/Card';
import { Catalog } from './screens/Catalog';
import { Status } from './screens/Status';
import { Keyring } from './screens/Keyring';
import { Profile } from './screens/Profile';
import { Funding } from './screens/Funding';
// Space (three.js) and Canvas (React Flow) are heavy — lazy-load so they only ship on open.
const Space = lazy(() => import('./screens/Space').then((m) => ({ default: m.Space })));
const Canvas = lazy(() => import('./screens/Canvas').then((m) => ({ default: m.Canvas })));
const lazyEl = (node: ReactNode) => <Suspense fallback={<div className="page"><div className="pw"><div className="empty"><div className="t">Loading…</div></div></div></div>}>{node}</Suspense>;
import { Vault } from './screens/Vault';
import { Projects } from './screens/Projects';
import { Dashboard } from './screens/Dashboard';
import { ProjectHub } from './screens/ProjectHub';
import { Datasets } from './screens/Datasets';
import { Dataset } from './screens/Dataset';
import { CaptionJob } from './screens/CaptionJob';
import { Derive } from './screens/Derive';
import { TrainRun } from './screens/TrainRun';
import { Shelf } from './screens/Shelf';
import { AccountSettings } from './screens/AccountSettings';
import { Preferences } from './screens/Preferences';
import { Collections } from './screens/Collections';
import { EditioHub } from './screens/EditioHub';
import { TraitsGarden } from './screens/TraitsGarden';
import { TraitRules } from './screens/TraitRules';
import { CanonicRun } from './screens/CanonicRun';
import { Curation } from './screens/Curation';
import { EditioExport } from './screens/EditioExport';
import { Trace } from './screens/Trace';
import { Run } from './screens/Run';
import { Studio } from './screens/Studio';
import { Tee } from './screens/Tee';
import { Map } from './screens/Map';
import { Onboard } from './screens/Onboard';
import { Landing } from './screens/Landing';
import { Ceremony } from './screens/Ceremony';
import { Feed } from './screens/Feed';
import { Doc } from './screens/Doc';
import { Stub } from './screens/Stub';
import aboutMd from './content/about.md?raw';
import featuresMd from './content/features.md?raw';
import pricingMd from './content/pricing.md?raw';
import blogMd from './content/blog.md?raw';
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
      <Route path="/train/run/:id" element={<TrainRun />} />
      <Route path="/models" element={<Shelf />} />
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
      <Route path="/projects" element={<Projects />} />
      <Route path="/projects/:id" element={<ProjectHub />} />
      <Route path="/run" element={<Run />} />
      <Route path="/canvas" element={lazyEl(<Canvas />)} />
      <Route path="/space" element={lazyEl(<Space />)} />
      <Route path="/trace" element={<Trace />} />
      <Route path="/keyring" element={<Keyring />} />
      <Route path="/vault" element={<Vault />} />
      <Route path="/profile" element={<Profile />} />
      <Route path="/status" element={<Status />} />
      <Route path="/account" element={<AccountSettings />} />
      <Route path="/account/:section" element={<AccountSettings />} />
      <Route path="/preferences" element={<Preferences />} />
      <Route path="/funding" element={<Funding />} />
      <Route path="/studio" element={<Studio />} />
      <Route path="/tee" element={<Tee />} />
      <Route path="/map" element={<Map />} />
      <Route path="/onboard" element={<Onboard />} />
      <Route path="/landing" element={<Landing />} />
      <Route path="/ceremony" element={<Ceremony />} />
      <Route path="/about" element={<Doc md={aboutMd} />} />
      <Route path="/features" element={<Doc md={featuresMd} />} />
      <Route path="/pricing" element={<Doc md={pricingMd} />} />
      <Route path="/blog" element={<Doc md={blogMd} />} />
      <Route path="/legal/privacy" element={<Doc md={privacyMd} />} />
      <Route path="/legal/cookies" element={<Doc md={cookiesMd} />} />
      <Route path="/legal/terms" element={<Doc md={termsMd} />} />
      <Route path="*" element={<Stub crumb="404" title="Not found" />} />
    </Routes>
  );
}
