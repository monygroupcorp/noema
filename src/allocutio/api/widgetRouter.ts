// =============================================================================
// widgetRouter — the `/widget` embed surface (ADR-0011 §7).
// =============================================================================
//
// Mounts the human-facing embed surface the `Noema` SDK drives:
//   GET /widget/sdk.js                       — the browser SDK (window.Noema)
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
// real per-partner `frame-ancestors` allowlist, resolved PER AGENT/COLLECTION via
// `deps.frameAncestors(legatus)` — a resolved `Legatus.frameAncestors` wins, else the
// platform-wide list, else `'self'` (see `frame()` below) — and the iframe posts only
// non-secret messages (WIDGET_READY / GALLERY_LIGHTBOX). We deliberately do NOT set
// X-Frame-Options — it cannot express an allowlist and would shadow the CSP.

import express, { type Router, type Request, type Response } from 'express'
import type { Legatus, LegatusStore } from '../../types/legatus.js'
import type { Appearance } from '../../types/consuetudo.js'
import type { AuctorKey } from '../../flow/types.js'
import type { FeedFilter } from '../../types/editio.js'
import type { Modorum, Modus, Porta } from '../../types/modus.js'
import type { FeedItem } from './types.js'
import { WIDGET_SDK_JS } from './widgetSdk.js'
import { buildQuote, type X402Config } from '../../crystal/x402Pricing.js'

export interface WidgetRouterDeps {
  legati: Pick<LegatusStore, 'findByAgentId' | 'listByCollection'>
  /** The public feed read (author-scoped for a per-agent view). */
  feed: (filter: FeedFilter) => Promise<FeedItem[]>
  /** Public appearance-by-owner projection (visual branding only). */
  appearance: (owner: AuctorKey) => Promise<Appearance | undefined>
  /** Resolve + LIST the agent's callable modi — enables the interactive run panel + picker. */
  modorum?: Pick<Modorum, 'find' | 'list'>
  /** Baseline run-cost estimate → the displayed price. Required with `modorum`. */
  quoteImpetus?: (modusId: string) => Promise<bigint>
  /** x402 rail config (currency label / markup) for the price display. */
  x402Config?: X402Config
  /**
   * Resolve the CSP `frame-ancestors` allowlist — the origins allowed to embed a given
   * agent's (or collection's) widget. Called per-request with the `Legatus` the route
   * resolved (`undefined` when none applies, e.g. an unknown agent or empty collection).
   * Implementations should fall back to the platform-wide list when the `Legatus` has no
   * `frameAncestors` of its own; the router's own `'self'` default applies if the
   * returned array is empty.
   */
  frameAncestors: (legatus: Legatus | undefined) => string[]
  /** Show the identity SIGN-IN affordance (challenge→session). Requires the host to serve
   *  the `/widget/:agentId/auth/wallet/*` endpoints. Default OFF: prod serves none, so the
   *  widget shows only real connect-wallet (no session) — no way to ship a spoofable login. */
  sessionAuth?: boolean
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

/** The shared chrome-less document skin — the real NOEMA design system (design/ tokens):
 *  Geist type, the surface + accent ramps, `--radius`, and the signature devices
 *  (.noema-frame hairline corners, .noema-kicker overline, .noema-rule). Themed live from
 *  the agent's Appearance (accent / avatar / banner / background). The `look` field is not
 *  yet wired (no per-look skins exist in the app); trust-fade is available but its viewer-
 *  identity trigger is gated on the auth work, so the agent's accent shows at full strength. */
function page(opts: {
  title: string
  appearance?: Appearance
  /** Caller-side theme override (gallery route only, ADR-0011 §7 partner-embed program) — the
   *  SDK's `initGallery({theme})` query params, sanitized. Absent/invalid channels keep the
   *  hardcoded NOEMA defaults below; presence never changes any other rendering. */
  theme?: { bg?: string; surface?: string; text?: string; textDim?: string }
  header?: string
  body: string
  script: string
}): string {
  const a = opts.appearance ?? {}
  const accent = safeColor(a.accent) ?? '#5b8cff'          // NOEMA --accent-500 default
  const bannerUrl = safeUrl(a.bannerUrl)
  const bgUrl = safeUrl(a.backgroundUrl)
  const banner = bannerUrl ? `<div class="banner" style="background-image:url('${esc(bannerUrl)}')"></div>` : ''
  const bgLayer = bgUrl ? `<div class="bgart" style="background-image:url('${esc(bgUrl)}')"></div>` : ''
  const t = opts.theme ?? {}
  const bg = t.bg ?? '#08090A'
  const surface = t.surface ?? '#0c0e10'
  const surface2 = t.surface ?? '#131619'
  const text = t.text ?? '#e7eaef'
  const textMuted = t.textDim ?? '#8b929c'
  const textSubtle = t.textDim ?? '#5b626c'
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(opts.title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600&family=Geist+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>
  :root {
    --accent:${accent};
    --bg:${bg}; --surface:${surface}; --surface-2:${surface2}; --border:#1c2024; --border-strong:#2a2f35;
    --text:${text}; --text-muted:${textMuted}; --text-subtle:${textSubtle}; --success:#5fd0a8;
    --radius:10px; --font:'Geist',ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,sans-serif;
    --mono:'Geist Mono',ui-monospace,SFMono-Regular,Menlo,monospace;
  }
  * { box-sizing:border-box; }
  html,body { margin:0; padding:0; min-height:100%; background:var(--bg); color:var(--text); font-family:var(--font); font-size:14px; line-height:1.45; }
  .bgart { position:fixed; inset:0; background-size:cover; background-position:center; opacity:.10; filter:saturate(.7); pointer-events:none; z-index:0; }
  .banner { height:104px; background-size:cover; background-position:center; }
  .wrap { position:relative; z-index:1; padding:16px; }
  /* signature frame — hairline border + icy corner ticks (.noema-frame) */
  .noema-frame { position:relative; border:1px solid var(--border); border-radius:var(--radius); background:var(--surface); padding:16px; }
  .noema-frame::before, .noema-frame::after { content:''; position:absolute; width:10px; height:10px; border:1.5px solid var(--accent); }
  .noema-frame::before { top:-1px; left:-1px; border-right:0; border-bottom:0; border-top-left-radius:var(--radius); }
  .noema-frame::after { bottom:-1px; right:-1px; border-left:0; border-top:0; border-bottom-right-radius:var(--radius); }
  .kicker { font-family:var(--mono); font-size:10px; text-transform:uppercase; letter-spacing:.14em; color:var(--accent); }
  .rule { height:1px; background:linear-gradient(90deg,var(--accent),transparent); margin:10px 0 14px; opacity:.5; }
  .hdr { display:flex; align-items:center; gap:12px; margin-bottom:14px; }
  .hmeta { min-width:0; }
  .avatar { width:44px; height:44px; border-radius:var(--radius); background:var(--surface-2) center/cover; border:1px solid var(--border-strong); flex:0 0 auto; }
  .hname { font-weight:600; font-size:15px; }
  .login { margin-left:auto; display:flex; align-items:center; gap:8px; font-family:var(--mono); font-size:11px; color:var(--text-muted); }
  .lo-btn { font-family:var(--mono); font-size:11px; padding:6px 12px; border-radius:999px; border:1px solid var(--accent); background:color-mix(in oklab,var(--accent) 14%,transparent); color:var(--text); cursor:pointer; }
  .lo-btn:hover { background:color-mix(in oklab,var(--accent) 22%,transparent); }
  .lo-dot { width:7px; height:7px; border-radius:999px; background:var(--success); box-shadow:0 0 6px var(--success); flex:0 0 auto; }
  .lo-badge { font-size:9px; text-transform:uppercase; letter-spacing:.08em; padding:2px 6px; border-radius:999px; background:var(--accent); color:#08090A; }
  .grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(140px,1fr)); gap:8px; }
  .tile { position:relative; border-radius:var(--radius); overflow:hidden; background:var(--surface-2); aspect-ratio:1/1; cursor:pointer; border:1px solid var(--border); transition:border-color .12s cubic-bezier(0.16,1,0.3,1); }
  .tile img, .tile video { width:100%; height:100%; object-fit:cover; display:block; }
  .tile--audio { aspect-ratio:auto; padding:10px; display:flex; align-items:center; cursor:default; }
  .tile--audio audio { width:100%; }
  .tile:hover { border-color:var(--accent); }
  .empty { padding:36px 12px; text-align:center; color:var(--text-subtle); font-size:13px; }
  .modpick { display:flex; flex-wrap:wrap; gap:6px; margin-bottom:14px; }
  .modchip { font-family:var(--mono); font-size:11px; padding:5px 10px; border-radius:999px; border:1px solid var(--border-strong); background:transparent; color:var(--text-muted); cursor:pointer; }
  .modchip.active { border-color:var(--accent); color:var(--text); background:color-mix(in oklab,var(--accent) 14%,transparent); }
  .mform { display:none; } .mform.active { display:block; }
  .field { display:block; margin-bottom:12px; }
  .flabel { display:block; font-size:12px; color:var(--text-muted); margin-bottom:5px; }
  .field textarea, .field input { width:100%; background:var(--surface-2); color:var(--text); border:1px solid var(--border-strong); border-radius:8px; padding:9px 10px; font:inherit; font-size:13px; }
  .field textarea { resize:vertical; min-height:64px; }
  .field textarea:focus, .field input:focus { outline:none; border-color:var(--accent); box-shadow:0 0 0 3px color-mix(in oklab,var(--accent) 18%,transparent); }
  .help { display:block; font-size:11px; color:var(--text-subtle); margin-top:4px; }
  #runbtn { background:var(--accent); color:#08090A; border:none; border-radius:8px; padding:10px 18px; font:inherit; font-weight:600; font-size:13px; cursor:pointer; }
  #runbtn:disabled { opacity:.45; cursor:default; }
  #rstatus { font-family:var(--mono); font-size:11px; color:var(--text-muted); margin:10px 0 6px; min-height:14px; }
  .bar { height:4px; border-radius:999px; background:var(--surface-2); border:1px solid var(--border); overflow:hidden; margin:0 0 12px; display:none; }
  .bar.on { display:block; } .bar > span { display:block; height:100%; width:0; background:var(--accent); transition:width .3s cubic-bezier(0.16,1,0.3,1); }
  .bar.indet > span { width:35%; animation:slide 1.1s infinite cubic-bezier(0.4,0,0.6,1); }
  @keyframes slide { 0%{margin-left:-35%} 100%{margin-left:100%} }
  .txt { white-space:pre-wrap; background:var(--surface-2); border:1px solid var(--border); border-radius:var(--radius); padding:12px; font-size:13px; }
  .sect { font-family:var(--mono); font-size:10px; text-transform:uppercase; letter-spacing:.12em; color:var(--text-subtle); margin:18px 0 10px; }
  .gate { border:1px solid var(--border); border-radius:var(--radius); background:var(--surface); padding:20px; margin-bottom:16px; }
  .gate .kicker { margin-bottom:8px; } .gate h3 { margin:0 0 6px; font-size:16px; font-weight:600; }
  .gate p { margin:0 0 14px; font-size:13px; color:var(--text-muted); }
  .gate form { display:flex; gap:8px; }
  .gate input { flex:1; background:var(--surface-2); color:var(--text); border:1px solid var(--border-strong); border-radius:8px; padding:10px; font:inherit; font-size:13px; }
  .gate input:focus { outline:none; border-color:var(--accent); box-shadow:0 0 0 3px color-mix(in oklab,var(--accent) 18%,transparent); }
  .gate button { background:var(--accent); color:#08090A; border:none; border-radius:8px; padding:10px 18px; font:inherit; font-weight:600; font-size:13px; cursor:pointer; }
</style></head>
<body>${bgLayer}${banner}<div class="wrap">${opts.header ?? ''}${opts.body}</div>
<script>${opts.script}</script></body></html>`
}

/** The agent header — avatar + name + a NOEMA kicker/rule, and the login pill on the right.
 *  `ownerAddress` (public on-chain) lets the client flip an "owner" badge; `sessionAuth`
 *  toggles the sign-in step (off → connect-wallet only, so prod can't ship a spoofable login). */
function agentHeader(agentId: string, appearance: Appearance | undefined, ownerAddress: string, sessionAuth: boolean): string {
  const avatarUrl = safeUrl(appearance?.avatarUrl)
  const avatar = `<div class="avatar"${avatarUrl ? ` style="background-image:url('${esc(avatarUrl)}')"` : ''}></div>`
  const owner = /^0x[0-9a-fA-F]{40}$/.test(ownerAddress) ? ownerAddress.toLowerCase() : ''
  const login = `<div id="login" class="login" data-owner="${esc(owner)}" data-session="${sessionAuth ? '1' : '0'}"></div>`
  return `<div class="hdr">${avatar}<div class="hmeta"><div class="kicker">Agent · on-chain</div>` +
    `<div class="hname">${esc(agentId)}</div></div>${login}</div><div class="rule"></div>`
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

// The login bridge (header pill). Connect-wallet is REAL (the SDK does eth_requestAccounts →
// WALLET_AVAILABLE); the "owner" badge is a client-side compare against the agent's on-chain
// owner. Sign-in (WALLET_AUTH_REQUEST → SESSION_READY) only renders when data-session=1 AND the
// host serves the auth endpoints — prod serves none, so no spoofable login can ship.
const LOGIN_JS = `(function(){
  var el=document.getElementById('login'); if(!el) return;
  var owner=(el.getAttribute('data-owner')||'').toLowerCase(), sessionAuth=el.getAttribute('data-session')==='1';
  var addr=null, signed=false;
  function short(a){ return a.slice(0,6)+'…'+a.slice(-4); }
  function ownerBadge(a){ return owner && a.toLowerCase()===owner ? ' <span class="lo-badge">owner</span>' : ''; }
  function render(){
    if(signed && addr){ el.innerHTML='<span class="lo-dot"></span>Signed in · '+short(addr)+ownerBadge(addr); return; }
    if(addr){ el.innerHTML='<span class="lo-dot"></span>'+short(addr)+ownerBadge(addr)+(sessionAuth?' <button class="lo-btn" id="lo-signin">Sign in</button>':'');
      var si=document.getElementById('lo-signin'); if(si) si.addEventListener('click',function(){ parent.postMessage({type:'WALLET_AUTH_REQUEST'},'*'); }); return; }
    el.innerHTML='<button class="lo-btn" id="lo-connect">Connect wallet</button>';
    document.getElementById('lo-connect').addEventListener('click',function(){ parent.postMessage({type:'CONNECT_WALLET'},'*'); });
  }
  window.addEventListener('message',function(e){ if(e.source!==window.parent) return; var m=e.data; if(!m||!m.type) return;
    if(m.type==='WALLET_AVAILABLE'){ addr=m.address; render(); }
    else if(m.type==='WALLET_DISCONNECTED'){ addr=null; signed=false; render(); }
    else if(m.type==='SESSION_READY'){ signed=true; render(); }
    else if(m.type==='WALLET_AUTH_ERROR'){ signed=false; render(); } });
  render();
})();`

// One form control per Modus `aditus` Porta. Text → textarea; int/float → number;
// media (image/video/audio/3d) → a URL field (the pay-per-call MVP takes media by URL).
function fieldHtml(name: string, porta: Porta): string {
  const label = esc(porta.label ?? name)
  const req = porta.required ? ' required' : ''
  const star = porta.required ? ' *' : ''
  const help = porta.description ? `<span class="help">${esc(porta.description)}</span>` : ''
  const n = esc(name)
  let control: string
  if (porta.type === 'text') {
    control = `<textarea name="${n}" rows="3"${req}></textarea>`
  } else if (porta.type === 'int' || porta.type === 'float') {
    control = `<input type="number" name="${n}" step="${porta.type === 'int' ? '1' : 'any'}"${req}>`
  } else {
    control = `<input type="url" name="${n}" placeholder="https://… (${esc(porta.type)} URL)"${req}>`
  }
  return `<label class="field"><span class="flabel">${label}${star}</span>${control}${help}</label>`
}

// The interactive run bridge (§5 x402, browser side), MULTI-MODUS aware. Each Modus is one
// <form class="mform" data-endpoint data-price data-modus>; chips toggle which is active. The
// run uses the ACTIVE form's endpoint + inputs: probe (POST → 402 + PaymentRequirements) → the
// parent SDK signs with the user's wallet (PAYMENT_REQUIRED → PAYMENT_SIGNED{header}) → re-POST
// with X-Payment → render the exitus. No session, no auth — the payment IS the auth (login is
// a separate, still-unwired concern; see the deps).
const RUN_SCRIPT = `(function(){
  var btn=document.getElementById('runbtn'), st=document.getElementById('rstatus'), out=document.getElementById('rresult'), bar=document.getElementById('rbar');
  var chips=Array.prototype.slice.call(document.querySelectorAll('.modchip'));
  var forms=Array.prototype.slice.call(document.querySelectorAll('.mform'));
  var lastInputs=null, lastEP=null, lastModus=null;
  function active(){ return document.querySelector('.mform.active') || forms[0]; }
  function status(m){ st.textContent=m||''; }
  function setBar(pct){ if(!bar) return; if(pct==null){ bar.className='bar on indet'; bar.firstChild.style.width='35%'; }
    else { bar.className='bar on'; bar.firstChild.style.width=Math.max(0,Math.min(100,pct))+'%'; } }
  function hideBar(){ if(bar) bar.className='bar'; }
  var PHASE={queued:'Queued',provisioning:'Provisioning GPU',pulling:'Pulling image',downloading:'Downloading',loading:'Loading model',executing:'Generating',uploading:'Uploading',complete:'Complete'};
  function showProgress(p){ if(!p) return; var line=PHASE[p.phase]||p.phase; if(p.target) line+=' · '+p.target;
    var pct=null;
    if(p.pod&&(p.pod.gpuType||p.pod.costPerHr)){ line+='  ('+(p.pod.gpuType||'gpu')+(p.pod.costPerHr?' @ $'+p.pod.costPerHr+'/hr':'')+')'; }
    if(p.progress&&typeof p.progress.done==='number'){ if(p.progress.total){ pct=Math.round(100*p.progress.done/p.progress.total); line+='  '+p.progress.done+'/'+p.progress.total+' '+(p.progress.unit||''); } else { line+='  '+p.progress.done+' '+(p.progress.unit||''); } }
    if(p.message) line+=' — '+p.message;
    status('▸ '+line); setBar(pct); }
  function selectModus(id){ forms.forEach(function(f){ f.classList.toggle('active', f.getAttribute('data-modus')===id); });
    chips.forEach(function(c){ c.classList.toggle('active', c.getAttribute('data-modus')===id); });
    var f=active(); if(f&&btn) btn.textContent='Run · '+f.getAttribute('data-price'); out.innerHTML=''; status(''); }
  chips.forEach(function(c){ c.addEventListener('click', function(){ selectModus(c.getAttribute('data-modus')); }); });
  function collect(f){ var o={}; Array.prototype.forEach.call(f.elements,function(el){
    if(!el.name||el.value==='')return; o[el.name]=(el.type==='number')?Number(el.value):el.value; }); return o; }
  function render(outputs){ out.innerHTML=''; hideBar();
    if(!outputs){ status('Done.'); return; }
    Object.keys(outputs).forEach(function(k){ var v=outputs[k];
      if(typeof v==='string'&&/^https?:/.test(v)){ var ext=v.split('?')[0].split('.').pop().toLowerCase(), m;
        if(/^(mp4|webm|mov)$/.test(ext)){m=document.createElement('video');m.src=v;m.controls=true;}
        else if(/^(mp3|wav|ogg|flac)$/.test(ext)){m=document.createElement('audio');m.src=v;m.controls=true;}
        else{m=document.createElement('img');m.src=v;m.loading='lazy';}
        var t=document.createElement('div');t.className='tile';t.appendChild(m);out.appendChild(t);
      } else if(typeof v==='string'){ var p=document.createElement('p');p.className='txt';p.textContent=v;out.appendChild(p); } });
    status('Done.'); }
  // The purse run (§7): the widget holds a Bursa token (the access code) and runs the agent's
  // modus on it via the existing /v1/runs path — no wallet, no x402 (that's the machine surface).
  // Dispatch → stream the run's real Progressus (/v1/runs/:id/stream) → fetch the exitus.
  var TOKEN=(document.getElementById('runwrap')||{}).getAttribute?document.getElementById('runwrap').getAttribute('data-code'):'';
  function finishRun(id){ fetch('/v1/runs/'+encodeURIComponent(id),{headers:{'x-bursa-token':TOKEN}})
    .then(function(r){return r.json();}).then(function(run){ hideBar(); render(run&&(run.outputs||run.exitus)); btn.disabled=false; })
    .catch(function(){ hideBar(); status('Done.'); btn.disabled=false; }); }
  function streamRun(id){ status('Started…'); setBar(null);
    fetch('/v1/runs/'+encodeURIComponent(id)+'/stream',{headers:{'x-bursa-token':TOKEN,'accept':'text/event-stream'}})
      .then(function(r){ var reader=r.body.getReader(),dec=new TextDecoder(),buf='';
        function handle(ev){ if(ev.kind==='progress') showProgress(ev.progressus);
          else if(ev.kind==='failed'||ev.status==='failed'){ hideBar(); status('Error: run failed'); btn.disabled=false; }
          else if(ev.terminal||ev.kind==='complete'){ finishRun(id); } }
        function pump(){ return reader.read().then(function(res){ if(res.done){ btn.disabled=false; return; }
          buf+=dec.decode(res.value,{stream:true}); var parts=buf.split('\\n\\n'); buf=parts.pop();
          parts.forEach(function(chunk){ var line=chunk.replace(/^data: ?/,'').trim(); if(!line||line[0]===':') return; try{ handle(JSON.parse(line)); }catch(e){} });
          return pump(); }); }
        return pump(); })
      .catch(function(e){ hideBar(); status('Error: '+e.message); btn.disabled=false; }); }
  if(btn) btn.addEventListener('click', function(){
    var f=active(); if(!f) return; lastModus=f.getAttribute('data-modus'); lastInputs=collect(f);
    if(!TOKEN){ status('No access code — reload with your code.'); return; }
    btn.disabled=true; out.innerHTML=''; status('Dispatching…');
    fetch('/v1/runs',{method:'POST',headers:{'content-type':'application/json','x-bursa-token':TOKEN},body:JSON.stringify({modusId:lastModus,aditus:lastInputs})})
      .then(function(r){ return r.json().then(function(d){return{status:r.status,data:d};}); })
      .then(function(p){ var id=p.data&&(p.data.id||p.data.runId);
        if(!id){ status('Error: '+((p.data&&p.data.error&&p.data.error.message)||('status '+p.status))); btn.disabled=false; return; }
        streamRun(id); })
      .catch(function(e){ status('Error: '+e.message); btn.disabled=false; }); });
  try{ parent.postMessage({type:'WIDGET_READY'},'*'); }catch(e){}
  document.addEventListener('click', function(ev){ var t=ev.target.closest&&ev.target.closest('.tile[data-url]');
    if(t){ try{ parent.postMessage({type:'GALLERY_LIGHTBOX',url:t.getAttribute('data-url')},'*'); }catch(e){} } });
})();`

// The entrance gate — shown when the widget has no access code. Redeeming = navigating to
// ?code=<token>, which reloads into the run panel holding that Bursa token.
const ENTRANCE_JS = `(function(){
  var form=document.getElementById('gateform'), inp=document.getElementById('gatecode');
  if(form) form.addEventListener('submit', function(e){ e.preventDefault(); var c=(inp.value||'').trim();
    if(c){ var u=new URL(location.href); u.searchParams.set('code', c); location.href=u.toString(); } });
  try{ parent.postMessage({type:'WIDGET_READY'},'*'); }catch(e){}
  document.addEventListener('click', function(ev){ var t=ev.target.closest&&ev.target.closest('.tile[data-url]');
    if(t){ try{ parent.postMessage({type:'GALLERY_LIGHTBOX',url:t.getAttribute('data-url')},'*'); }catch(e){} } });
})();`

export function createWidgetRouter(deps: WidgetRouterDeps): Router {
  const router = express.Router({ mergeParams: true })
  const limit = deps.limit ?? 24

  /** Apply the per-partner framing allowlist to an embeddable HTML view. `legatus` is
   *  whatever the route resolved for this request (or `undefined`) — passed through to
   *  `deps.frameAncestors` so a per-agent list can win over the platform-wide default. */
  function frame(res: Response, legatus: Legatus | undefined): void {
    const ancestors = deps.frameAncestors(legatus)
    const frameAncestors = ancestors.length ? ancestors.join(' ') : "'self'"
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
    const activeAgents = agents.filter((a) => a.status !== 'revoked')
    const animaIds = activeAgents.map((a) => a.animaId)
    const items = animaIds.length ? await deps.feed({ visibility: 'feed', authorAnimaIds: animaIds, limit }) : []
    const tiles = items.flatMap((i) => tilesFromOutput(i.output))
    const body = tiles.length
      ? `<div class="grid">${tiles.map(tileHtml).join('')}</div>`
      : `<div class="empty">No creations in this collection yet.</div>`
    // A collection has no single `Legatus` — every agent in it belongs to the same
    // partner, so the first one carrying a per-partner `frameAncestors` speaks for the
    // whole gallery. None set (the common case) → `frame()` falls back to the global list.
    const perPartner = activeAgents.find((a) => a.frameAncestors && a.frameAncestors.length)

    // Caller-side theme override (`Noema.initGallery({theme})` — widgetSdk.ts). The SDK has
    // always sent these query params; the server ignored them until now. This route has no
    // single owner to resolve an `Appearance` from (a collection spans N agents, each its own
    // Anima), so there is no "stored" accent to layer on top of here — each channel is either
    // the caller's sanitized value or the page's built-in default, exactly as before this param
    // existed. Reuses `safeColor()` (the same gate the per-agent route uses for its Appearance
    // accent) — a malformed/unsafe value is dropped silently, never injected raw, never errors.
    const themeAccent = safeColor(req.query.accent)
    const theme = {
      bg: safeColor(req.query.bg),
      surface: safeColor(req.query['card-bg']),
      text: safeColor(req.query.text),
      textDim: safeColor(req.query['text-dim']),
    }
    frame(res, perPartner)
    res.status(200).send(page({
      title: 'Gallery',
      ...(themeAccent ? { appearance: { accent: themeAccent } } : {}),
      theme,
      body,
      script: IFRAME_BRIDGE,
    }))
  })

  // GET /widget/:agentId — a chrome-less, themed, INTERACTIVE per-agent view: run the
  // agent's Modus (pay-per-call via x402) above its recent-creations gallery.
  router.get('/:agentId', async (req: Request, res: Response): Promise<void> => {
    const agentId = String(req.params.agentId)
    const legatus = await deps.legati.findByAgentId(agentId)
    if (!legatus || legatus.status === 'revoked') {
      frame(res, legatus ?? undefined)
      res.status(404).send(page({ title: 'Not found', body: `<div class="empty">Agent not found.</div>`, script: IFRAME_BRIDGE }))
      return
    }
    const owner: AuctorKey = { animaId: legatus.animaId }
    const [appearance, items] = await Promise.all([
      deps.appearance(owner),
      deps.feed({ visibility: 'feed', author: owner, limit }),
    ])

    // The agent's callable modi: everything the owning animaId authored, plus the private
    // starter workspace modus (which may not be owned by the animaId). Deduped, workspace first.
    let modi: Modus[] = []
    if (deps.modorum && deps.quoteImpetus && deps.x402Config) {
      const authored = deps.modorum.list ? await deps.modorum.list({ auctor: owner }) : []
      const byId = new Map(authored.map((m) => [m.id, m]))
      if (legatus.workspaceModusId && !byId.has(legatus.workspaceModusId)) {
        const ws = await deps.modorum.find(legatus.workspaceModusId)
        if (ws) modi = [ws, ...authored]
        else modi = authored
      } else {
        modi = authored
      }
    }

    // The access code (a Bursa token) — from `?code=`. Present → the run panel (runs spend
    // that purse via /v1/runs); absent → the entrance gate. The widget is for code/account
    // holders (§7); x402 is the separate machine surface.
    const code = typeof req.query.code === 'string' ? req.query.code : ''
    let panel = ''
    let script = IFRAME_BRIDGE
    if (modi.length && deps.quoteImpetus) {
      if (code) {
        const quoteImpetus = deps.quoteImpetus
        const panels = await Promise.all(modi.map(async (m, i) => {
          const impetus = await quoteImpetus(m.id)
          const price = `~${impetus.toString()} cr`
          const fields = Object.entries(m.aditus).map(([name, porta]) => fieldHtml(name, porta)).join('')
          return {
            chip: `<button class="modchip${i === 0 ? ' active' : ''}" data-modus="${esc(m.id)}">${esc(m.nomen)}</button>`,
            form: `<form class="mform${i === 0 ? ' active' : ''}" data-modus="${esc(m.id)}" data-price="${esc(price)}" onsubmit="return false">${fields}</form>`,
            price,
          }
        }))
        const picker = modi.length > 1 ? `<div class="modpick">${panels.map((p) => p.chip).join('')}</div>` : ''
        panel =
          `<div class="run" id="runwrap" data-code="${esc(code)}">${picker}${panels.map((p) => p.form).join('')}` +
          `<button id="runbtn">Run · ${esc(panels[0].price)}</button>` +
          `<div id="rstatus"></div><div id="rbar" class="bar"><span></span></div><div id="rresult" class="grid"></div></div>`
        script = RUN_SCRIPT
      } else {
        panel =
          `<div class="gate"><div class="kicker">Access</div><h3>Enter your access code</h3>` +
          `<p>Paste the invite code the owner shared to run this agent on its balance.</p>` +
          `<form id="gateform"><input id="gatecode" placeholder="access code" autocomplete="off" spellcheck="false" autofocus>` +
          `<button type="submit">Continue</button></form></div>`
        script = ENTRANCE_JS
      }
    }

    const tiles = items.flatMap((i) => tilesFromOutput(i.output))
    const gallery = tiles.length
      ? `<div class="sect">Recent creations</div><div class="grid">${tiles.map(tileHtml).join('')}</div>`
      : (panel ? '' : `<div class="empty">This agent hasn't published anything yet.</div>`)
    // `mode` dispatch (ADR-0011 §7 partner-embed program). `Noema.init({mode})` — widgetSdk.ts —
    // has always sent this query param (default 'list'); the server ignored it until now.
    // 'list' — including no `mode` at all, or any value this server doesn't recognize (fail
    // open, never error a page over a bad query param) — is the pre-existing combined view,
    // untouched: this is the regression bar for the live route. 'panel' and 'gallery' are new
    // opt-in single-section renders (the extensibility point for a future widget-presentation
    // library); nothing reaches them unless a caller explicitly asks for them.
    const modeParam = typeof req.query.mode === 'string' ? req.query.mode : 'list'
    let body: string
    let bodyScript: string
    if (modeParam === 'panel') {
      body = panel
      bodyScript = script
    } else if (modeParam === 'gallery') {
      body = tiles.length
        ? `<div class="sect">Recent creations</div><div class="grid">${tiles.map(tileHtml).join('')}</div>`
        : `<div class="empty">This agent hasn't published anything yet.</div>`
      bodyScript = IFRAME_BRIDGE
    } else {
      body = panel + gallery
      bodyScript = script
    }

    frame(res, legatus)
    res.status(200).send(page({
      title: agentId, ...(appearance ? { appearance } : {}),
      header: agentHeader(agentId, appearance, legatus.ownerAddress, deps.sessionAuth ?? false),
      body, script: LOGIN_JS + bodyScript,
    }))
  })

  return router
}
