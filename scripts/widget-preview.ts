// =============================================================================
// widget-preview — a standalone local sandbox for the /widget embed surface.
// =============================================================================
//
//   npx tsx scripts/widget-preview.ts        # then open http://localhost:4402
//
// Boots the REAL widgetRouter + agentCardRouter with fake in-memory data (no Mongo,
// no GPU, no wallet), plus:
//   • a demo "partner page" at /  that loads /widget/sdk.js and mounts the widget +
//     gallery exactly like a real embedder would — with a MOCK wallet so you can click
//     Run and watch the whole 402 → sign → result flow render;
//   • a stub x402 endpoint so the paid run returns a fake image instead of 500ing.
// This shows how it DISPLAYS; it does not move any real money.

import express from 'express'
import { createWidgetRouter } from '../src/allocutio/api/widgetRouter.js'
import { createAgentCardRouter } from '../src/allocutio/api/agentCardRouter.js'
import { DEFAULT_X402_CONFIG, buildQuote, acceptFor, buildPaymentRequirements } from '../src/crystal/x402Pricing.js'
import type { Legatus } from '../src/types/legatus.js'
import type { Modus } from '../src/types/modus.js'

const PORT = Number(process.env.PORT ?? 4402)
const BASE = `http://localhost:${PORT}`

// ── Fake data ────────────────────────────────────────────────────────────────
const legatus = {
  agentId: 'camel42', tokenId: '42', adapter: '0x' + 'b'.repeat(40), chainId: 8453,
  ownerAddress: '0x' + 'a'.repeat(40), animaId: 'anima-1', treasuryId: 'camelcabal-1',
  issuerId: 'https://camelcabal.fun', scope: ['generate'], revokeToken: 'rvk',
  workspaceModusId: 'm1', status: 'active', natum: new Date(),
} as unknown as Legatus

// Three capabilities the agent offers (all owned by its animaId → the modus picker lists them).
const MODI = [
  { id: 'm1', nomen: 'memeify', auctor: { animaId: 'anima-1' }, aditus: {
    prompt: { type: 'text', required: true, label: 'Prompt', description: 'What should the agent make?' },
    style: { type: 'text', label: 'Style', description: 'Optional style hint' },
    seed: { type: 'int', label: 'Seed' },
  } },
  { id: 'm2', nomen: 'upscale', auctor: { animaId: 'anima-1' }, aditus: {
    image: { type: 'image', required: true, label: 'Image URL', description: 'The image to upscale' },
    factor: { type: 'int', label: 'Factor', description: '2 or 4' },
  } },
  { id: 'm3', nomen: 'describe', auctor: { animaId: 'anima-1' }, aditus: {
    image: { type: 'image', required: true, label: 'Image URL' },
  } },
] as unknown as Modus[]
const modusById = (id: string) => MODI.find((m) => m.id === id) ?? null

const DEMO_IMAGES = [
  'https://picsum.photos/seed/noema1/400', 'https://picsum.photos/seed/noema2/400',
  'https://picsum.photos/seed/noema3/400', 'https://picsum.photos/seed/noema4/400',
  'https://picsum.photos/seed/noema5/400', 'https://picsum.photos/seed/noema6/400',
]
const feedItems = DEMO_IMAGES.map((url, i) => ({
  editionId: `e${i}`, artifact: { kind: 'actum' as const, id: `a${i}` },
  output: { image: url }, createdAt: new Date().toISOString(),
}))

const app = express()

// The real widget surface, wired with fakes. frameAncestors 'self' lets the same-origin
// demo page embed the iframe.
app.use('/widget', createWidgetRouter({
  legati: { findByAgentId: async (id) => (id === 'camel42' ? legatus : null), listByCollection: async () => [legatus] },
  feed: async () => feedItems,
  appearance: async () => ({
    accent: '#57c8a6',
    avatarUrl: 'https://picsum.photos/seed/avatar/120',
    bannerUrl: 'https://picsum.photos/seed/banner/1200/240',
    backgroundUrl: 'https://picsum.photos/seed/bgart/1200/800',
  }),
  modorum: { find: async (id) => modusById(id), list: async () => MODI },
  quoteImpetus: async (id) => (id === 'm2' ? 2400n : id === 'm3' ? 400n : 1200n),
  x402Config: { ...DEFAULT_X402_CONFIG, payTo: '0x' + 'c'.repeat(40) },
  sessionAuth: true,            // sandbox-only: show the sign-in step (mocked endpoints below)
  frameAncestors: () => ["'self'"],
}))

// MOCK sign-in endpoints (sandbox only — prod serves none, so the widget shows connect-wallet
// only). The SDK's wallet-auth flow POSTs here: nonce → sign → verify → a fake session JWT.
app.post('/widget/:agentId/auth/wallet/nonce', express.json(), (_req, res) => {
  res.json({
    domain: { name: 'NOEMA', version: '1', chainId: 8453 },
    types: { Auth: [{ name: 'statement', type: 'string' }, { name: 'nonce', type: 'string' }] },
    message: { statement: 'Sign in to this NOEMA agent (sandbox)', nonce: 'mock-nonce-' + Math.random().toString(36).slice(2) },
  })
})
app.post('/widget/:agentId/auth/wallet/verify', express.json(), (_req, res) => {
  res.json({ sessionJwt: 'mock.sandbox.session' })   // NOT a real credential
})

app.use(createAgentCardRouter({
  legati: { findByAgentId: async (id) => (id === 'camel42' ? legatus : null) },
  modorum: { find: async (id) => modusById(id) },
  quoteImpetus: async () => 1200n,
  x402Config: { ...DEFAULT_X402_CONFIG, payTo: '0x' + 'c'.repeat(40) },
  publicBase: BASE,
  platform: { name: 'NOEMA', description: 'preview', publicBase: BASE },
}))

// Stub x402 run endpoint. The probe → 402. The paid POST STREAMS fake Progressus phases as
// SSE (mirroring the real x402AgentRouter) so the widget's live-status UI is visible, then a
// final result event — or returns JSON if the caller didn't ask for a stream.
app.post('/api/v1/x402/agents/:agentId/spell/:name', express.json(), (req, res) => {
  const cfg = { ...DEFAULT_X402_CONFIG, payTo: '0x' + 'c'.repeat(40) }
  const quote = buildQuote(1200n, cfg)
  if (!req.get('x-payment')) {
    res.status(402).json({
      error: 'PAYMENT_REQUIRED',
      paymentRequired: buildPaymentRequirements(quote, cfg, { url: `${BASE}${req.originalUrl}`, description: 'preview' }),
      quote: { baseCostUsd: quote.baseCostUsd, markupUsd: quote.markupUsd, totalCostUsd: quote.totalCostUsd },
    })
    return
  }
  const prompt = String(req.body?.inputs?.prompt ?? 'your prompt')
  const result = { runId: 'run-preview', status: 'complete', outputs: { image: `https://picsum.photos/seed/${encodeURIComponent(prompt).slice(0, 12)}/600`, caption: `“${prompt}” — made by agent camel42 (preview)` } }

  // SSE stream of fake Progressus phases (mirrors the real x402AgentRouter). We write raw to
  // the socket to sidestep Express's response buffering in this preview process; the widget's
  // reader falls back to JSON automatically if a host doesn't stream.
  if ((req.get('accept') ?? '').includes('text/event-stream')) {
    const sock = res.socket
    if (sock) {
      sock.write('HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nCache-Control: no-cache\r\nConnection: keep-alive\r\n\r\n')
      const tape: Array<Record<string, unknown>> = [
        { kind: 'started', runId: 'run-preview' },
        { kind: 'progress', progressus: { phase: 'queued' } },
        { kind: 'progress', progressus: { phase: 'provisioning', pod: { gpuType: 'RTX 4090', costPerHr: 0.34 } } },
        { kind: 'progress', progressus: { phase: 'downloading', target: 'model', progress: { done: 2, total: 5, unit: 'items' } } },
        { kind: 'progress', progressus: { phase: 'downloading', target: 'model', progress: { done: 5, total: 5, unit: 'items' } } },
        { kind: 'progress', progressus: { phase: 'executing', progress: { done: 8, total: 30, unit: 'steps' } } },
        { kind: 'progress', progressus: { phase: 'executing', progress: { done: 22, total: 30, unit: 'steps' } } },
        { kind: 'progress', progressus: { phase: 'uploading' } },
        { kind: 'result', ...result },
      ]
      let i = 0, alive = true
      sock.on('close', () => { alive = false })
      const step = (): void => {
        if (!alive || sock.destroyed) return
        if (i >= tape.length) { sock.end(); return }
        sock.write('data: ' + JSON.stringify(tape[i++]) + '\n\n')
        setTimeout(step, 550)
      }
      step()
      return
    }
  }
  res.json(result)
})

// MOCK purse-run endpoints (the widget's human path). The widget POSTs /v1/runs with an
// x-bursa-token (the access code), streams /v1/runs/:id/stream, then fetches the outputs.
app.post('/v1/runs', express.json(), (_req, res) => res.json({ id: 'run-purse', status: 'pending' }))
app.get('/v1/runs/:id', (_req, res) =>
  res.json({ id: 'run-purse', status: 'complete', outputs: { image: `https://picsum.photos/seed/purse${Math.floor(Math.random() * 1e6)}/600`, caption: 'Made on your purse (preview)' } }))
app.get('/v1/runs/:id/stream', (_req, res) => {
  const sock = res.socket
  if (!sock) { res.status(204).end(); return }
  sock.write('HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nCache-Control: no-cache\r\nConnection: keep-alive\r\n\r\n')
  const tape: Array<Record<string, unknown>> = [
    { kind: 'snapshot', run: { id: 'run-purse', status: 'pending' } },
    { kind: 'progress', terminal: false, progressus: { phase: 'queued' } },
    { kind: 'progress', terminal: false, progressus: { phase: 'provisioning', pod: { gpuType: 'RTX 4090', costPerHr: 0.34 } } },
    { kind: 'progress', terminal: false, progressus: { phase: 'downloading', target: 'model', progress: { done: 3, total: 5, unit: 'items' } } },
    { kind: 'progress', terminal: false, progressus: { phase: 'executing', progress: { done: 14, total: 30, unit: 'steps' } } },
    { kind: 'progress', terminal: false, progressus: { phase: 'uploading' } },
    { kind: 'complete', terminal: true, status: 'complete' },
  ]
  let i = 0, alive = true
  sock.on('close', () => { alive = false })
  const step = (): void => {
    if (!alive || sock.destroyed) return
    if (i >= tape.length) { sock.end(); return }
    sock.write('data: ' + JSON.stringify(tape[i++]) + '\n\n')
    setTimeout(step, 550)
  }
  step()
})

// A demo partner page: loads the SDK, mounts the widget + gallery, injects a MOCK wallet.
app.get('/', (_req, res) => {
  res.type('html').send(`<!doctype html><html><head><meta charset="utf-8">
<title>NOEMA widget sandbox</title>
<style>
  body { margin:0; background:#f4f4f6; color:#222; font-family:system-ui,sans-serif; }
  header { padding:16px 20px; background:#fff; border-bottom:1px solid #e5e5ea; }
  h1 { font-size:16px; margin:0; } .sub { color:#888; font-size:12px; margin-top:4px; }
  .cols { display:flex; gap:20px; padding:20px; flex-wrap:wrap; align-items:flex-start; }
  .card { background:#fff; border:1px solid #e5e5ea; border-radius:12px; overflow:hidden; box-shadow:0 2px 12px rgba(0,0,0,.05); }
  .card h2 { font-size:12px; text-transform:uppercase; letter-spacing:.05em; color:#999; margin:0; padding:12px 14px; border-bottom:1px solid #eee; }
  .agent { width:420px; } .agent .mount { height:640px; }
  .gallery { width:520px; } .gallery .mount { height:420px; }
  .mount { display:block; }
  .links { padding:8px 20px 20px; font-size:12px; color:#888; }
  .links a { color:#7c5cff; }
</style></head><body>
<header><h1>NOEMA widget sandbox</h1>
<div class="sub">The real /widget surface with fake data + a mock wallet — click <b>Run</b> to watch the 402 → sign → result flow.</div></header>
<div class="cols">
  <div class="card agent"><h2>Noema.init — per-agent widget (camel42)</h2><div id="agent" class="mount"></div></div>
  <div class="card gallery"><h2>Noema.initGallery — collection gallery</h2><div id="gallery" class="mount"></div></div>
</div>
<div class="links">
  Raw views:
  <a href="/widget/camel42" target="_blank">/widget/camel42</a> ·
  <a href="/widget/gallery/0xdemo" target="_blank">/widget/gallery/0xdemo</a> ·
  <a href="/widget/sdk.js" target="_blank">/widget/sdk.js</a> ·
  <a href="/.well-known/agent-card.json" target="_blank">agent-card.json</a>
</div>
<script>
  // A MOCK wallet so the pay flow completes without a real provider.
  var mockWallet = {
    request: function (args) {
      if (args.method === 'eth_accounts' || args.method === 'eth_requestAccounts') return Promise.resolve(['0x' + 'a'.repeat(40)]);
      if (args.method === 'eth_signTypedData_v4') return Promise.resolve('0x' + 'f'.repeat(130));
      return Promise.resolve(null);
    },
  };
</script>
<script src="/widget/sdk.js"></script>
<script>
  Noema.init({ agentId: 'camel42', container: document.getElementById('agent'),
    getProvider: function () { return mockWallet; }, onEvent: function (e) { console.log('[agent]', e); } });
  Noema.initGallery({ collectionAddress: '0xdemo', container: document.getElementById('gallery') });
</script>
</body></html>`)
})

app.listen(PORT, () => {
  console.log(`\n  NOEMA widget sandbox → ${BASE}\n  (Ctrl-C to stop)\n`)
})
