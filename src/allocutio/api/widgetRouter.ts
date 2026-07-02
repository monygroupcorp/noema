// =============================================================================
// widgetRouter — the `/widget` embed surface (ADR-0011 §7).
// =============================================================================
//
// Mounts the human-facing embed surface the `StationThis` SDK drives:
//   GET /widget/sdk.js                       — the browser SDK (window.StationThis)
//   GET /widget/:agentId                     — a chrome-less, themed per-agent view
//   GET /widget/gallery/:collectionAddress   — a chrome-less recent-creations gallery
//
// NO NEW DATA TYPE (§7): the views are composed from existing primitives — the public
// feed (`api.feed`, author-scoped for the per-agent view), the owner's `Appearance`
// (`api.publicAppearance`) for theming, and `Legatus.findByAgentId` to map a
// `camel{tokenId}` slug → the agent's `animaId`/branding. The heavy legacy widget
// backend (spell-casting, buy-points, delegations) is deliberately NOT ported; the
// interactive path is the §5 x402 capability endpoints, which the SDK already speaks.
//
// FRAMING is hardened vs the legacy `frame-ancestors *`: every HTML view carries a
// real per-partner `frame-ancestors` allowlist (deps.frameAncestors), and the iframe
// posts only non-secret messages (WIDGET_READY / GALLERY_LIGHTBOX). We deliberately do
// NOT set X-Frame-Options — it cannot express an allowlist and would shadow the CSP.

import express, { type Router, type Request, type Response } from 'express'
import type { LegatusStore } from '../../types/legatus.js'
import type { Appearance } from '../../types/consuetudo.js'
import type { AuctorKey } from '../../flow/types.js'
import type { FeedFilter } from '../../types/editio.js'
import type { FeedItem } from './types.js'
import { WIDGET_SDK_JS } from './widgetSdk.js'

export interface WidgetRouterDeps {
  legati: Pick<LegatusStore, 'findByAgentId' | 'listByCollection'>
  /** The public feed read (author-scoped for a per-agent view). */
  feed: (filter: FeedFilter) => Promise<FeedItem[]>
  /** Public appearance-by-owner projection (visual branding only). */
  appearance: (owner: AuctorKey) => Promise<Appearance | undefined>
  /** CSP `frame-ancestors` allowlist — the origins allowed to embed the widgets. */
  frameAncestors: string[]
  /** How many feed tiles to render (default 24). */
  limit?: number
}

// ── HTML/URL safety ──────────────────────────────────────────────────────────
function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string))
}
/** Only http(s)/data URLs survive — never `javascript:` etc. Returns '' if unsafe. */
function safeUrl(u: unknown): string {
  if (typeof u !== 'string') return ''
  return /^(https?:|data:image\/)/i.test(u.trim()) ? u.trim() : ''
}
/** A CSS color token we're willing to inline (hex / rgb / hsl / a bare css name). */
function safeColor(c: unknown): string | undefined {
  if (typeof c !== 'string') return undefined
  return /^#[0-9a-f]{3,8}$/i.test(c) || /^(rgb|hsl)a?\([0-9.,%\s/]+\)$/i.test(c) || /^[a-z]{3,20}$/i.test(c) ? c : undefined
}

const VIDEO = /^(mp4|webm|mov|m4v)$/i
const AUDIO = /^(mp3|wav|ogg|flac|m4a)$/i
type Tile = { url: string; kind: 'image' | 'video' | 'audio' }

/** Reverse of the produce-side projector: pull display media URLs out of a feed item's
 *  `output` (exitus) record. Mirrors the frontend `lib/media.ts` extraction, self-contained. */
function tilesFromOutput(output: Record<string, unknown> | undefined): Tile[] {
  if (!output) return []
  const tiles: Tile[] = []
  for (const v of Object.values(output)) {
    const values = Array.isArray(v) ? v : [v]
    for (const item of values) {
      const url = safeUrl(typeof item === 'object' && item !== null && 'url' in item ? (item as { url: unknown }).url : item)
      if (!url) continue
      const ext = url.split('?')[0].split('.').pop() ?? ''
      tiles.push({ url, kind: VIDEO.test(ext) ? 'video' : AUDIO.test(ext) ? 'audio' : 'image' })
    }
  }
  return tiles
}

function tileHtml(t: Tile): string {
  const u = esc(t.url)
  if (t.kind === 'video') return `<div class="tile"><video src="${u}" muted loop playsinline preload="metadata"></video></div>`
  if (t.kind === 'audio') return `<div class="tile tile--audio"><audio src="${u}" controls preload="none"></audio></div>`
  return `<div class="tile" data-url="${u}"><img src="${u}" loading="lazy" alt=""></div>`
}

/** The shared chrome-less document skin, themed from the owner's Appearance. */
function page(opts: { title: string; appearance?: Appearance; body: string; script: string }): string {
  const a = opts.appearance ?? {}
  const accent = safeColor(a.accent) ?? '#7c5cff'
  const bg = safeColor((a as { bg?: string }).bg) ?? '#0b0b0d'
  const bannerUrl = safeUrl(a.bannerUrl)
  const banner = bannerUrl
    ? `<div class="banner" style="background-image:url('${esc(bannerUrl)}')"></div>` : ''
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(opts.title)}</title>
<style>
  :root { --accent:${accent}; --bg:${bg}; }
  * { box-sizing:border-box; }
  html,body { margin:0; padding:0; height:100%; background:var(--bg); color:#e8e8ea;
    font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif; }
  .banner { height:96px; background-size:cover; background-position:center;
    border-bottom:1px solid rgba(255,255,255,.06); }
  .wrap { padding:12px; }
  .grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(140px,1fr)); gap:8px; }
  .tile { position:relative; border-radius:8px; overflow:hidden; background:#151519;
    aspect-ratio:1/1; cursor:pointer; border:1px solid rgba(255,255,255,.05); }
  .tile img, .tile video { width:100%; height:100%; object-fit:cover; display:block; }
  .tile--audio { aspect-ratio:auto; padding:10px; display:flex; align-items:center; cursor:default; }
  .tile--audio audio { width:100%; }
  .tile:hover { border-color:var(--accent); }
  .empty { padding:32px 12px; text-align:center; color:#6a6a72; font-size:13px; }
</style></head>
<body>${banner}<div class="wrap">${opts.body}</div>
<script>${opts.script}</script></body></html>`
}

// The in-iframe bridge: announce readiness, and lift clicks to the parent lightbox.
const IFRAME_BRIDGE = `(function(){
  try { parent.postMessage({ type:'WIDGET_READY' }, '*'); } catch(e){}
  document.addEventListener('click', function(ev){
    var t = ev.target.closest && ev.target.closest('.tile[data-url]');
    if (!t) return;
    try { parent.postMessage({ type:'GALLERY_LIGHTBOX', url:t.getAttribute('data-url') }, '*'); } catch(e){}
  });
})();`

export function createWidgetRouter(deps: WidgetRouterDeps): Router {
  const router = express.Router({ mergeParams: true })
  const limit = deps.limit ?? 24
  const frameAncestors = deps.frameAncestors.length ? deps.frameAncestors.join(' ') : "'self'"

  /** Apply the per-partner framing allowlist to an embeddable HTML view. */
  function frame(res: Response): void {
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.setHeader('Content-Security-Policy', `frame-ancestors ${frameAncestors}`)
    res.setHeader('Cache-Control', 'no-store')
  }

  // GET /widget/sdk.js — the browser SDK. Loaded via <script>, so no framing header.
  router.get('/sdk.js', (_req: Request, res: Response): void => {
    res.setHeader('Content-Type', 'application/javascript; charset=utf-8')
    res.setHeader('Cache-Control', 'public, max-age=300')
    res.status(200).send(WIDGET_SDK_JS)
  })

  // GET /widget/gallery/:collectionAddress — the public creations of one NFT
  // collection: the agents whose ERC-8004 `adapter` contract is this address (the
  // JWT-parsed `Legatus.adapter`), scoped to their published feed editions.
  router.get('/gallery/:collectionAddress', async (req: Request, res: Response): Promise<void> => {
    const addr = String(req.params.collectionAddress)
    const agents = await deps.legati.listByCollection(addr)
    const animaIds = agents.filter((a) => a.status !== 'revoked').map((a) => a.animaId)
    const items = animaIds.length ? await deps.feed({ visibility: 'feed', authorAnimaIds: animaIds, limit }) : []
    const tiles = items.flatMap((i) => tilesFromOutput(i.output))
    const body = tiles.length
      ? `<div class="grid">${tiles.map(tileHtml).join('')}</div>`
      : `<div class="empty">No creations in this collection yet.</div>`
    frame(res)
    res.status(200).send(page({ title: 'Gallery', body, script: IFRAME_BRIDGE }))
  })

  // GET /widget/:agentId — a chrome-less, themed view of one agent's public feed.
  router.get('/:agentId', async (req: Request, res: Response): Promise<void> => {
    const agentId = String(req.params.agentId)
    const legatus = await deps.legati.findByAgentId(agentId)
    if (!legatus || legatus.status === 'revoked') {
      frame(res)
      res.status(404).send(page({ title: 'Not found', body: `<div class="empty">Agent not found.</div>`, script: IFRAME_BRIDGE }))
      return
    }
    const owner: AuctorKey = { animaId: legatus.animaId }
    const [appearance, items] = await Promise.all([
      deps.appearance(owner),
      deps.feed({ visibility: 'feed', author: owner, limit }),
    ])
    const tiles = items.flatMap((i) => tilesFromOutput(i.output))
    const body = tiles.length
      ? `<div class="grid">${tiles.map(tileHtml).join('')}</div>`
      : `<div class="empty">This agent hasn't published anything yet.</div>`
    frame(res)
    res.status(200).send(page({ title: agentId, ...(appearance ? { appearance } : {}), body, script: IFRAME_BRIDGE }))
  })

  return router
}
