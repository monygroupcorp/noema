import { lazy, Suspense, type ReactNode } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { Landing } from './screens/Landing';
import { TermsGate } from './shell/TermsGate';

// Landing (and its stylesheet) is the only screen imported eagerly: it owns the root route,
// and a stranger hitting "/" or "/pricing" should download that page, not the whole app.
// Every other screen — including the ones that look innocuous, like Doc or Pricing — is
// lazy-loaded so its code (and, for the markdown docs, its content) only ships once a visitor
// actually navigates there. The landing-load-budget test (src/entryBudget.test.ts) holds the
// resulting entry chunk to a size budget; route-splitting is how it stays under it.
const lazyEl = (node: ReactNode) => <Suspense fallback={<div className="page"><div className="pw"><div className="empty"><div className="t">Loading…</div></div></div></div>}>{node}</Suspense>;

const Chat = lazy(() => import('./screens/Chat').then((m) => ({ default: m.Chat })));
const Card = lazy(() => import('./screens/Card').then((m) => ({ default: m.Card })));
const Catalog = lazy(() => import('./screens/Catalog').then((m) => ({ default: m.Catalog })));
const Status = lazy(() => import('./screens/Status').then((m) => ({ default: m.Status })));
const Keyring = lazy(() => import('./screens/Keyring').then((m) => ({ default: m.Keyring })));
const Profile = lazy(() => import('./screens/Profile').then((m) => ({ default: m.Profile })));
const Funding = lazy(() => import('./screens/Funding').then((m) => ({ default: m.Funding })));
const Partner = lazy(() => import('./screens/Partner').then((m) => ({ default: m.Partner })));
// Space (three.js), Canvas (React Flow) and Vault (circomlibjs/snarkjs ZK) are heavy —
// lazy-load so they only ship on open.
const Space = lazy(() => import('./screens/Space').then((m) => ({ default: m.Space })));
const Canvas = lazy(() => import('./screens/Canvas').then((m) => ({ default: m.Canvas })));
const Vault = lazy(() => import('./screens/Vault').then((m) => ({ default: m.Vault })));
// Coded design laboratory for the landing redesign (STANDARD §7.2). The plate slots it renders
// are unfilled placeholders, and an unfinished slot must never be able to reach a visitor — so
// the import itself is behind the dev flag, not just the route. With DEV false this collapses to
// `null`, the dynamic import is unreachable, and neither the component nor its stylesheet is
// emitted into the production build.
const PlateLab = import.meta.env.DEV
  ? lazy(() => import('./screens/PlateLab').then((m) => ({ default: m.PlateLab })))
  : null;
const Projects = lazy(() => import('./screens/Projects').then((m) => ({ default: m.Projects })));
const Dashboard = lazy(() => import('./screens/Dashboard').then((m) => ({ default: m.Dashboard })));
const ProjectHub = lazy(() => import('./screens/ProjectHub').then((m) => ({ default: m.ProjectHub })));
const Datasets = lazy(() => import('./screens/Datasets').then((m) => ({ default: m.Datasets })));
const Dataset = lazy(() => import('./screens/Dataset').then((m) => ({ default: m.Dataset })));
const CaptionJob = lazy(() => import('./screens/CaptionJob').then((m) => ({ default: m.CaptionJob })));
const Derive = lazy(() => import('./screens/Derive').then((m) => ({ default: m.Derive })));
const Muse = lazy(() => import('./screens/Muse').then((m) => ({ default: m.Muse })));
const MuseSessions = lazy(() => import('./screens/Muse').then((m) => ({ default: m.MuseSessions })));
const TrainRun = lazy(() => import('./screens/TrainRun').then((m) => ({ default: m.TrainRun })));
const Shelf = lazy(() => import('./screens/Shelf').then((m) => ({ default: m.Shelf })));
const Teams = lazy(() => import('./screens/Teams').then((m) => ({ default: m.Teams })));
const Sponsorships = lazy(() => import('./screens/Sponsorships').then((m) => ({ default: m.Sponsorships })));
const AccountSettings = lazy(() => import('./screens/AccountSettings').then((m) => ({ default: m.AccountSettings })));
const Preferences = lazy(() => import('./screens/Preferences').then((m) => ({ default: m.Preferences })));
const Collections = lazy(() => import('./screens/Collections').then((m) => ({ default: m.Collections })));
const EditioHub = lazy(() => import('./screens/EditioHub').then((m) => ({ default: m.EditioHub })));
const TraitsGarden = lazy(() => import('./screens/TraitsGarden').then((m) => ({ default: m.TraitsGarden })));
const TraitRules = lazy(() => import('./screens/TraitRules').then((m) => ({ default: m.TraitRules })));
const CanonicRun = lazy(() => import('./screens/CanonicRun').then((m) => ({ default: m.CanonicRun })));
const Curation = lazy(() => import('./screens/Curation').then((m) => ({ default: m.Curation })));
const EditioExport = lazy(() => import('./screens/EditioExport').then((m) => ({ default: m.EditioExport })));
const Run = lazy(() => import('./screens/Run').then((m) => ({ default: m.Run })));
const Studio = lazy(() => import('./screens/Studio').then((m) => ({ default: m.Studio })));
const Onboard = lazy(() => import('./screens/Onboard').then((m) => ({ default: m.Onboard })));
const Ceremony = lazy(() => import('./screens/Ceremony').then((m) => ({ default: m.Ceremony })));
const Feed = lazy(() => import('./screens/Feed').then((m) => ({ default: m.Feed })));
const Examples = lazy(() => import('./screens/Examples').then((m) => ({ default: m.Examples })));
const Review = lazy(() => import('./screens/Review').then((m) => ({ default: m.Review })));
const AdminWorkspace = lazy(() => import('./screens/AdminWorkspace').then((m) => ({ default: m.AdminWorkspace })));
const AdminPartnerRequests = lazy(() => import('./screens/AdminPartnerRequests').then((m) => ({ default: m.AdminPartnerRequests })));
const AdminReports = lazy(() => import('./screens/AdminReports').then((m) => ({ default: m.AdminReports })));
const Blog = lazy(() => import('./screens/Blog').then((m) => ({ default: m.Blog })));
const BlogPost = lazy(() => import('./screens/Blog').then((m) => ({ default: m.BlogPost })));
const Pricing = lazy(() => import('./screens/Pricing').then((m) => ({ default: m.Pricing })));
const RequestDemo = lazy(() => import('./screens/RequestDemo').then((m) => ({ default: m.RequestDemo })));
const Stub = lazy(() => import('./screens/Stub').then((m) => ({ default: m.Stub })));

// Each legal/info doc pairs the Doc renderer (react-markdown + remark-gfm) with one `?raw`
// markdown file. Loading the content alongside the renderer, inside one dynamic import,
// keeps both out of the entry chunk — importing the text at App.tsx module scope (the
// previous shape) would have shipped it eagerly even with Doc itself lazy.
const AboutDoc = lazy(async () => {
  const [{ Doc }, { default: md }] = await Promise.all([import('./screens/Doc'), import('./content/about.md?raw')]);
  return { default: () => <Doc md={md} /> };
});
const FeaturesDoc = lazy(async () => {
  const [{ Doc }, { default: md }] = await Promise.all([import('./screens/Doc'), import('./content/features.md?raw')]);
  return { default: () => <Doc md={md} /> };
});
const PrivacyDoc = lazy(async () => {
  const [{ Doc }, { default: md }] = await Promise.all([import('./screens/Doc'), import('./content/privacy.md?raw')]);
  return { default: () => <Doc md={md} /> };
});
const CookiesDoc = lazy(async () => {
  const [{ Doc }, { default: md }] = await Promise.all([import('./screens/Doc'), import('./content/cookies.md?raw')]);
  return { default: () => <Doc md={md} /> };
});
const TermsDoc = lazy(async () => {
  const [{ Doc }, { default: md }] = await Promise.all([import('./screens/Doc'), import('./content/terms.md?raw')]);
  return { default: () => <Doc md={md} /> };
});
// MiniMax's licence for MiniMax H3, verbatim from MiniMaxAI/MiniMax-H3 on Hugging Face (licence
// date 2026-08-02). Section III.1 of it requires a copy to reach every user. Replace the whole
// file when MiniMax publishes a new version; do not edit the text.
const MinimaxH3LicenseDoc = lazy(async () => {
  const [{ Doc }, { default: md }] = await Promise.all([import('./screens/Doc'), import('./content/minimax-h3-license.md?raw')]);
  return { default: () => <Doc md={md} /> };
});

export function App() {
  return (
    <>
    {/* One dialog for every screen that starts a run: a run under licence terms waits on it. */}
    <TermsGate />
    <Routes>
      {/* Marketing Landing owns the root; the app shell's Home/dashboard is /app. */}
      <Route path="/" element={<Landing />} />
      <Route path="/app" element={lazyEl(<Dashboard />)} />
      <Route path="/chat" element={lazyEl(<Chat />)} />
      <Route path="/datasets" element={lazyEl(<Datasets />)} />
      <Route path="/datasets/:id" element={lazyEl(<Dataset />)} />
      <Route path="/datasets/:id/caption" element={lazyEl(<CaptionJob />)} />
      <Route path="/datasets/:id/derive" element={lazyEl(<Derive />)} />
      <Route path="/datasets/:id/muse" element={lazyEl(<Muse />)} />
      {/* The sessions broken off a dataset (noema-274). The bare muse route above still
          means "resume the most recently worked session"; one specific session is named
          on it as `?session=<id>`, which leaves that existing meaning — and every link
          and bookmark carrying it — untouched. */}
      <Route path="/datasets/:id/muse/sessions" element={lazyEl(<MuseSessions />)} />
      <Route path="/train/run/:id" element={lazyEl(<TrainRun />)} />
      <Route path="/models" element={lazyEl(<Shelf />)} />
      <Route path="/teams" element={lazyEl(<Teams />)} />
      <Route path="/sponsorships" element={lazyEl(<Sponsorships />)} />
      <Route path="/collections" element={lazyEl(<Collections />)} />
      <Route path="/collections/:id" element={lazyEl(<EditioHub />)} />
      <Route path="/collections/:id/garden" element={lazyEl(<TraitsGarden />)} />
      <Route path="/collections/:id/rules" element={lazyEl(<TraitRules />)} />
      <Route path="/collections/:id/run" element={lazyEl(<CanonicRun />)} />
      <Route path="/collections/:id/curation" element={lazyEl(<Curation />)} />
      <Route path="/collections/:id/export" element={lazyEl(<EditioExport />)} />
      <Route path="/card" element={lazyEl(<Card />)} />
      <Route path="/catalog" element={lazyEl(<Catalog />)} />
      <Route path="/examples" element={lazyEl(<Examples />)} />
      <Route path="/feed" element={lazyEl(<Feed />)} />
      {/* Moderation held-queue (publishing spec §4). /review was the author-facing home; its
          pending-items UI is now a conditional section on Feed itself (noema-075), so /review is
          just a redirect. /admin/review (the moderation queue: approve/reject/confirm-csam,
          me.admin-gated, server-enforced regardless) is unaffected. */}
      <Route path="/review" element={<Navigate to="/feed" replace />} />
      <Route path="/admin/review" element={lazyEl(<Review />)} />
      {/* Admin workspace hub (noema-011): links the review queue + read-only revenue/COGS
          cards. me.admin-gated client-side; every report re-gates server-side regardless. */}
      <Route path="/admin" element={lazyEl(<AdminWorkspace />)} />
      {/* B2B partner-program intake review (partner-embed-07): the admin-only queue for
          /v1/admin/partner-requests, linked from the admin workspace hub the same way
          /admin/review is. */}
      <Route path="/admin/partner-requests" element={lazyEl(<AdminPartnerRequests />)} />
      {/* In-app report triage (bug/feature/feedback/abuse) for /v1/admin/reports
          (minimax-h3-violation-takedown), linked from the admin workspace hub the same way
          /admin/review and /admin/partner-requests are. */}
      <Route path="/admin/reports" element={lazyEl(<AdminReports />)} />
      <Route path="/projects" element={lazyEl(<Projects />)} />
      <Route path="/projects/:id" element={lazyEl(<ProjectHub />)} />
      <Route path="/run" element={lazyEl(<Run />)} />
      <Route path="/canvas" element={lazyEl(<Canvas />)} />
      <Route path="/space" element={lazyEl(<Space />)} />
      <Route path="/keyring" element={lazyEl(<Keyring />)} />
      <Route path="/vault" element={lazyEl(<Vault />)} />
      <Route path="/profile" element={lazyEl(<Profile />)} />
      <Route path="/status" element={lazyEl(<Status />)} />
      <Route path="/account" element={lazyEl(<AccountSettings />)} />
      <Route path="/account/:section" element={lazyEl(<AccountSettings />)} />
      <Route path="/preferences" element={lazyEl(<Preferences />)} />
      <Route path="/funding" element={lazyEl(<Funding />)} />
      <Route path="/partner" element={lazyEl(<Partner />)} />
      <Route path="/studio" element={lazyEl(<Studio />)} />
      <Route path="/onboard" element={lazyEl(<Onboard />)} />
      <Route path="/landing" element={<Landing />} />
      {PlateLab && <Route path="/lab/landing" element={lazyEl(<PlateLab />)} />}
      <Route path="/ceremony" element={lazyEl(<Ceremony />)} />
      {/* Fiat auth — sign-in / create lives inline in Door A (/onboard). No email, so
          no verify/reset token pages; recovery is via backup channels bound in the profile. */}
      <Route path="/about" element={lazyEl(<AboutDoc />)} />
      <Route path="/features" element={lazyEl(<FeaturesDoc />)} />
      <Route path="/pricing" element={lazyEl(<Pricing />)} />
      {/* Public "become a B2B partner" intake (partner-embed-07) — mirrors /pricing: no auth
          check, public route. Posts to /v1/partner-requests (partnerRequestRouter.ts). */}
      <Route path="/partners" element={lazyEl(<RequestDemo />)} />
      <Route path="/blog" element={lazyEl(<Blog />)} />
      <Route path="/blog/:slug" element={lazyEl(<BlogPost />)} />
      <Route path="/legal/privacy" element={lazyEl(<PrivacyDoc />)} />
      <Route path="/legal/cookies" element={lazyEl(<CookiesDoc />)} />
      <Route path="/legal/terms" element={lazyEl(<TermsDoc />)} />
      <Route path="/legal/minimax-h3-license" element={lazyEl(<MinimaxH3LicenseDoc />)} />
      <Route path="*" element={lazyEl(<Stub crumb="404" title="Not found" />)} />
    </Routes>
    </>
  );
}
