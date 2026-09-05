import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useSearchParams, Link } from 'react-router-dom';
import { AppShell } from '../shell/AppShell';
import { Ic } from '../lib/icons';
import { useIdentity } from '../state/identity';
import { api, getActivePurse, setActivePurse, type FlowDescription, type ModelCard } from '../lib/api';
import { mediaFromOutput } from '../lib/media';
import { isPinned, togglePin } from '../lib/pins';
import { usePromptAssist, useAssistField } from '../state/promptAssist';
import { fieldExample } from '../lib/promptExamples';
import { humanizeKey } from '../lib/labels';
import { STAGE_LABELS, measure, useRunStream } from '../lib/runStream';
import { publishNote, publishOutcome } from '../lib/editio';
import { Lightbox } from '../components/Lightbox';

type Aditus = Record<string, unknown>;

// Autosave debounce for the Card form's affines writes — same timing as Canvas's
// tabula autosave (Canvas.tsx AUTOSAVE_DEBOUNCE_MS) so the app is consistent.
const AUTOSAVE_DEBOUNCE_MS = 1500;

function cleanAditus(a: Aditus): Aditus {
  const out: Aditus = {};
  for (const [k, v] of Object.entries(a)) if (v !== '' && v !== undefined && v !== null) out[k] = v;
  return out;
}

// ── Live LoRA trigger-word highlight (composer courtesy — see noema-061) ────────
// The concierge's prompt string can carry `<lora:name:weight>` syntax, but nobody
// asks the USER to type that — they just type the trigger word, and the serving
// path (loraResolver.ts) resolves it for them. This is the read-only, client-side
// courtesy half: highlight a recognized trigger AS THEY TYPE and let them hover it
// for the model card, so they know a LoRA activated. No serving-path change, no
// post-generation UI change — display only.

/** A minimal whole-word, case-insensitive alternation over the known trigger
 *  strings, longest-first so a longer trigger wins over a shorter one it contains.
 *  Deliberately NOT loraResolver.ts's `_substringScan`/`_specialTokenScan` (out of
 *  scope) — this only needs to decide "does this look like a match", not resolve. */
function buildTriggerRegex(triggers: string[]): RegExp | null {
  if (triggers.length === 0) return null;
  const escaped = triggers
    .slice()
    .sort((a, b) => b.length - a.length)
    .map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp(`\\b(?:${escaped.join('|')})\\b`, 'gi');
}

type HitSeg = { text: string; hit?: ModelCard };

/** Split `text` into plain/hit segments against `loraMap` (lowercased trigger →
 *  ModelCard). Pure — used to render the highlight overlay from the live value. */
function splitTriggerHits(text: string, loraMap: Map<string, ModelCard>, re: RegExp | null): HitSeg[] {
  if (!re || !text) return [{ text }];
  const segs: HitSeg[] = [];
  let last = 0;
  re.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) segs.push({ text: text.slice(last, m.index) });
    segs.push({ text: m[0], hit: loraMap.get(m[0].toLowerCase()) });
    last = m.index + m[0].length;
    if (m[0].length === 0) re.lastIndex += 1;
  }
  if (last < text.length) segs.push({ text: text.slice(last) });
  return segs;
}

/** A single highlighted trigger-word hit. The `.lora-trigger-card` model-card
 *  popover is `createPortal`ed to `document.body` (noema-071) so it escapes both
 *  `.lora-trigger-overlay{overflow:hidden}` (this span's immediate ancestor, load-
 *  bearing for the transparent-text-mirroring illusion — see HighlightedPromptField)
 *  and the farther-out `.cardscroll{overflow:auto}` — same bug class/fix shape as
 *  noema-069's Rail.tsx dropup portal. Since the popover is no longer a DOM
 *  descendant of the hit span, CSS `:hover`/`:focus` can't reach it any more, so
 *  show/hide moves to JS state mirroring the same trigger conditions. Anchored ONCE
 *  on open via `getBoundingClientRect()` — no resize/scroll re-anchoring (deliberately
 *  narrower than noema-069's live-tracked version; this trigger word is static text). */
function TriggerHitSpan({ text, hit }: { text: string; hit: ModelCard }) {
  const [anchor, setAnchor] = useState<{ left: number; bottom: number } | null>(null);
  const ref = useRef<HTMLSpanElement>(null);
  const open = () => {
    const r = ref.current?.getBoundingClientRect();
    if (r) setAnchor({ left: r.left, bottom: window.innerHeight - r.top + 6 });
  };
  const close = () => setAnchor(null);
  return (
    <span
      className="lora-trigger-hit"
      tabIndex={0}
      ref={ref}
      onMouseEnter={open}
      onMouseLeave={close}
      onFocus={open}
      onBlur={close}
    >
      {text}
      {anchor &&
        createPortal(
          <span className="lora-trigger-card" role="tooltip" style={{ left: anchor.left, bottom: anchor.bottom }}>
            <strong>{hit.nomen}</strong>
            {hit.trigger && <span className="ltc-trigger">{hit.trigger}</span>}
            {hit.description && <p>{hit.description}</p>}
            <span className="ltc-meta">{hit.access ?? 'public'} · {hit.license ?? 'unknown license'}</span>
          </span>,
          document.body,
        )}
    </span>
  );
}

/** The prompt/lyric/story textarea + a mirrored highlight overlay behind it. The
 *  overlay's own text is transparent (glyphs still come from the real textarea on
 *  top); only a matched trigger's `<span className="lora-trigger-hit">` paints a
 *  visible background, and re-enables pointer events (hover/focus) just for itself
 *  so the rest of the overlay stays click-through to the real textarea beneath. */
function HighlightedPromptField(props: {
  value: string;
  placeholder?: string;
  onChange: (v: string) => void;
  loraMap: Map<string, ModelCard>;
  triggerRe: RegExp | null;
  assistProps: Record<string, unknown>;
}) {
  const { value, placeholder, onChange, loraMap, triggerRe, assistProps } = props;
  const segs = useMemo(() => splitTriggerHits(value, loraMap, triggerRe), [value, loraMap, triggerRe]);
  return (
    <div className="lora-trigger-wrap">
      <div className="lora-trigger-overlay" aria-hidden="true">
        {segs.map((s, i) =>
          s.hit ? <TriggerHitSpan key={i} text={s.text} hit={s.hit} /> : <span key={i}>{s.text}</span>,
        )}
        {/* trailing marker so a trailing newline still contributes overlay height */}
        {'​'}
      </div>
      <textarea className="ta2 lora-trigger-ta" value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} {...assistProps} />
    </div>
  );
}

// ── The work axis ──────────────────────────────────────────────────────────────
// Every run executes on our compute (remote) — the honest, only posture. The old
// remote/TEE/local dial is gone: there is no on-device path, and TEE is in development
// (de-surfaced). `noema sees:` is WHO (funding); the WHAT is always remote now.

export function Card() {
  const { ident } = useIdentity();
  const [params] = useSearchParams();
  const id = params.get('id') || 'flux-schnell';
  // A leased warm studio to run on (from /studio's "Run here") — rides the dispatch as-is.
  const studioId = params.get('studio') || undefined;
  // Carried from Shelf's "Use in a flow" (noema-062): an imported model's trigger word,
  // pre-included in the prompt so the LoRA is easy to use immediately (server-side
  // src/crystal/loraResolver.ts resolves the trigger word into the adapter at run time —
  // unmodified here). `loraName` only drives the concierge note below.
  const preloadPrompt = params.get('prompt') || undefined;
  const loraName = params.get('loraName') || undefined;

  const [flow, setFlow] = useState<FlowDescription | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [aditus, setAditus] = useState<Aditus>({});
  const [quote, setQuote] = useState<{ impetus?: string; error?: string } | null>(null);
  const [quoting, setQuoting] = useState(false);
  // The run being watched — set once createRun succeeds; the actual live status
  // (phases, elapsed, terminal honesty) rides `useRunStream`, not local polling.
  const [runId, setRunId] = useState<string | undefined>();
  const [dispatching, setDispatching] = useState(false);
  const [dispatchErr, setDispatchErr] = useState<string | undefined>();
  const runStream = useRunStream(runId);
  const [pinned, setPinned] = useState(false);
  const [lightbox, setLightbox] = useState(false);
  // Publish-to-feed state for the current result.
  // 'refused' is separate from 'err': the moderation gate declined this result, which is
  // terminal and comes with a reason, where 'err' is a request that failed and can be retried.
  // Before this, a refusal was reported as 'done' — the POST's returned edition was thrown
  // away, so a publish the gate had already rejected told its author "In review", and they
  // waited on a feed appearance that was never coming.
  const [pub, setPub] = useState<{ s: 'idle' | 'busy' | 'done' | 'refused' | 'err'; msg?: string }>({ s: 'idle' });
  // The active anonymous purse (Vault "use this purse") this run will spend from, if any.
  // createRun() sends it as x-bursa-token; here we only surface it + offer a clear affordance.
  const [activePurse, setActivePurseState] = useState<string | null>(getActivePurse());
  useEffect(() => { setPinned(isPinned(id)); }, [id]);

  // Whether the caller owns this flow — reuses the "is this mine" membership check
  // the palette build already relies on (FlowSummary carries no owner field over the
  // wire; see Canvas.tsx's dedupeFlows). Gates the "Edit in Canvas" link below.
  const [mine, setMine] = useState(false);
  useEffect(() => {
    let live = true;
    api.listMyFlows().then((r) => { if (live) setMine((r.flows ?? []).some((f) => f.id === id)); }).catch(() => { if (live) setMine(false); });
    return () => { live = false; };
  }, [id]);

  // Whether this flow is the current cross-platform `/make` default (web + Telegram share
  // the same binding, keyed by owner identity — see Preferences.tsx's rebindMake()).
  const [makeDefault, setMakeDefault] = useState(false);
  const [bindBusy, setBindBusy] = useState(false);
  const [bindErr, setBindErr] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    api.getMe().then((m) => { if (live) setMakeDefault(m.bindings.find((b) => b.verb === 'make')?.modusId === id); }).catch(() => { /* best-effort */ });
    return () => { live = false; };
  }, [id]);

  // Rebind /make to this flow (PUT /v1/me/bindings/make) — optimistic, reverts on error.
  // Same pattern as Preferences.tsx's rebindMake().
  function setAsMakeDefault() {
    const prev = makeDefault;
    setMakeDefault(true);
    setBindBusy(true);
    setBindErr(null);
    api.setBinding('make', id)
      .then(() => setBindBusy(false))
      .catch((e) => { setMakeDefault(prev); setBindBusy(false); setBindErr(e instanceof Error ? e.message : String(e)); });
  }

  // Prompt augmentation: register prompt fields with the Concierge on focus,
  // and release the assist target when this card unmounts.
  const { clear } = usePromptAssist();
  const assist = useAssistField();
  useEffect(() => () => clear(), [clear]);

  // Per-flow saved input defaults (affines). Loaded on mount (hydrates in-progress inputs),
  // autosaved debounced on change, and savable-as-defaults on demand via the explicit button.
  const [affSave, setAffSave] = useState<{ s: 'idle' | 'busy' | 'done' | 'err'; msg?: string }>({ s: 'idle' });
  const affSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Skip the autosave triggered by the load effect's own setAditus (Canvas.tsx pattern) —
  // only user edits should schedule a write.
  const skipNextAffSave = useRef(true);

  // Live LoRA trigger-word highlight — the composer courtesy (noema-061). Fetched once
  // per flow load (keyed on flow.familia, the base-model compatibility family the
  // backend derives read-only in describeFlow()); cached, not refetched per keystroke.
  const [loraMap, setLoraMap] = useState<Map<string, ModelCard>>(new Map());
  useEffect(() => {
    if (!flow?.familia) { setLoraMap(new Map()); return; }
    let live = true;
    api.listModelsByBasis(flow.familia)
      .then((r) => {
        if (!live) return;
        const map = new Map<string, ModelCard>();
        for (const m of r.models ?? []) if (m.trigger) map.set(m.trigger.toLowerCase(), m);
        setLoraMap(map);
      })
      .catch(() => { if (live) setLoraMap(new Map()); });
    return () => { live = false; };
  }, [flow?.familia]);
  const triggerRe = useMemo(() => buildTriggerRegex(Array.from(loraMap.keys())), [loraMap]);

  // fetch the real flow schema + seed the form from defaults, then overlay saved affines
  useEffect(() => {
    let live = true;
    setFlow(null); setLoadErr(null); setRunId(undefined); setDispatching(false); setDispatchErr(undefined); setQuote(null); setAffSave({ s: 'idle' });
    skipNextAffSave.current = true;
    if (affSaveTimer.current) clearTimeout(affSaveTimer.current);
    api.getFlow(id).then((f) => {
      if (!live) return;
      setFlow(f);
      const init: Aditus = {};
      for (const [k, p] of Object.entries(f.input?.properties ?? {})) {
        if (p.default !== undefined) init[k] = p.default;
        else if (k === 'prompt') init[k] = preloadPrompt || 'a low-poly n64-style dragon perched on a neon temple, dusk';
        else init[k] = '';
      }
      // Overlay the caller's saved defaults for this flow — the autosaved in-progress
      // inputs if any (getAffines returns the same key autosave writes to), else the
      // last explicit "save defaults" (best-effort — anon-capable).
      api.getAffines(id)
        .then((r) => { if (live) setAditus({ ...init, ...(r.affines ?? {}) }); })
        .catch(() => { if (live) setAditus(init); });
    }).catch((e) => { if (live) setLoadErr(String(e)); });
    return () => { live = false; };
  }, [id]);

  // Debounced autosave of the in-progress inputs, keyed to this flow's affines (same
  // key/endpoint the manual "save defaults" button and the hydrate-on-mount read use —
  // Card.tsx:271-273) so navigating away or refreshing restores the same card's typed
  // inputs, not just the last explicit save. Mirrors Canvas.tsx's tabula autosave
  // (debounce after change, skip the load-triggered initial value, last-write-wins on
  // the debounced value since each change clears and reschedules the pending timer).
  useEffect(() => {
    if (!flow) return;
    if (skipNextAffSave.current) { skipNextAffSave.current = false; return; }
    setAffSave({ s: 'busy' });
    if (affSaveTimer.current) clearTimeout(affSaveTimer.current);
    affSaveTimer.current = setTimeout(() => {
      api.setAffines(id, cleanAditus(aditus))
        .then(() => setAffSave({ s: 'done' }))
        .catch((e) => setAffSave({ s: 'err', msg: e instanceof Error ? e.message : String(e) }));
    }, AUTOSAVE_DEBOUNCE_MS);
    return () => { if (affSaveTimer.current) clearTimeout(affSaveTimer.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aditus, flow, id]);

  async function saveDefaults() {
    if (affSaveTimer.current) clearTimeout(affSaveTimer.current);
    setAffSave({ s: 'busy' });
    try {
      await api.setAffines(id, cleanAditus(aditus));
      setAffSave({ s: 'done' });
    } catch (e) {
      setAffSave({ s: 'err', msg: e instanceof Error ? e.message : String(e) });
    }
  }

  // live quote (debounced) once required fields are present
  const required = useMemo(() => flow?.input?.required ?? [], [flow]);
  useEffect(() => {
    if (!flow) return;
    const ready = required.every((k) => aditus[k] !== '' && aditus[k] !== undefined);
    if (!ready) { setQuote(null); return; }
    const t = setTimeout(() => {
      setQuoting(true);
      api.quote({ modusId: id, aditus: cleanAditus(aditus) })
        .then((r) => setQuote({ impetus: r.impetus }))
        .catch((e) => setQuote({ error: String(e) }))
        .finally(() => setQuoting(false));
    }, 400);
    return () => clearTimeout(t);
  }, [flow, aditus, required, id]);

  function set(k: string, v: unknown) { setAditus((a) => ({ ...a, [k]: v })); }

  async function publishToFeed(actumId: string) {
    setPub({ s: 'busy' });
    try {
      const { edition } = await api.publish({ artifact: { kind: 'actum', id: actumId }, destination: 'feed', visibility: 'feed', custody: 'ours' });
      if (publishOutcome(edition) === 'refused') { setPub({ s: 'refused', msg: publishNote(edition) }); return; }
      // 'settling' and 'held' are both honestly "in review" here — the copy promises a feed
      // appearance only once approved, which is true of either.
      setPub({ s: 'done' });
    } catch (e) {
      setPub({ s: 'err', msg: e instanceof Error ? e.message : String(e) });
    }
  }

  async function doRun() {
    setPub({ s: 'idle' });
    setDispatchErr(undefined);
    setRunId(undefined);
    setDispatching(true);
    try {
      const { run: r } = await api.createRun({ modusId: id, aditus: cleanAditus(aditus), ...(studioId ? { studioId } : {}) });
      // Live status (phases, elapsed, terminal honesty) streams via useRunStream(runId).
      setRunId(r.id);
    } catch (e) {
      setDispatchErr(String(e));
    } finally {
      setDispatching(false);
    }
  }

  // Credit model (credits only — never a $/hr market rate). The live quote's
  // impetus is the upper-bound base credit estimate for a run on our compute.
  const baseCredits = quote?.impetus ? Math.round(Number(quote.impetus)) : null;
  const creditText =
    quoting ? '…'
    : quote?.error ? 'quote failed'
    : baseCredits == null ? '—'
    : `~${baseCredits} credits`;
  // Subline: honest consequence, or a fill-fields hint when the quote can't form yet.
  const subline = quote?.error ? 'fill required fields' : 'est · remote · we see the work';
  const name = (flow?.nomen || id).split('—')[0].trim();

  // Live run status, derived (SSE with polling fallback — see useRunStream).
  const runStatus =
    dispatchErr ? 'failed'
    : dispatching ? 'dispatching…'
    : !runId ? undefined
    : runStream.terminal === 'complete' ? 'complete'
    : runStream.terminal === 'failed' ? 'failed'
    : 'running';
  const runElapsedLabel = runId && !runStream.terminal ? ` · ${runStream.elapsedSec}s elapsed` : '';
  const media = mediaFromOutput(runStream.exitus);

  const context = (
    <>
      <div className="csec">
        <div className="ctitle">Flow</div>
        <div className="meta-line"><span>id</span><span className="v mono">{id}</span></div>
        <div className="meta-line"><span>version</span><span className="v mono">{flow?.versio ?? '—'}</span></div>
        <div className="meta-line"><span>base model</span><span className="v mono">{String((flow as { fundamentumId?: unknown })?.fundamentumId ?? '—')}</span></div>
        <div className="meta-line"><span>category</span><span className="v mono">{String((flow as { categoria?: unknown })?.categoria ?? '—')}</span></div>
        {studioId && <div className="meta-line"><span>studio</span><span className="v mono">{studioId.slice(0, 8)} · warm</span></div>}
      </div>
      <div className="csec">
        <div className="ctitle">Account</div>
        <div className="meta-line"><span>balance</span><span className="v mono">{ident.bal}</span></div>
      </div>
    </>
  );

  return (
    <AppShell crumb={<>Catalogue <span className="sep">/</span> {id}</>} context={context}>
      {/* Live LoRA trigger-word highlight — kept local to Card.tsx (no app.css edit).
          The overlay mirrors the "ta2" textarea's box exactly (see .lora-trigger-wrap
          sizing the box, .lora-trigger-ta made transparent-background to sit on top
          of it): its own glyphs are transparent, only a hit span paints a highlight
          background + re-enables pointer events for hover/focus. */}
      <style>{`
        .lora-trigger-wrap{position:relative}
        .lora-trigger-overlay{position:absolute;inset:0;padding:9px 11px;border:1px solid transparent;
          font:inherit;line-height:1.5;white-space:pre-wrap;word-wrap:break-word;overflow:hidden;
          color:transparent;pointer-events:none;z-index:1}
        .lora-trigger-ta.ta2{position:relative;background:transparent;z-index:0}
        .lora-trigger-hit{position:relative;background:color-mix(in srgb,var(--accent) 35%,transparent);
          border-radius:3px;pointer-events:auto;cursor:help}
        /* noema-071: portaled to document.body (out of .lora-trigger-overlay's overflow:hidden and
           .cardscroll's overflow:auto — same fix shape as noema-069's Rail.tsx dropup), so position
           is fixed + anchored via inline left/bottom from TriggerHitSpan's getBoundingClientRect()
           instead of position:absolute relative to the (no-longer-ancestor) hit span. Shown/hidden by
           JS state now (see TriggerHitSpan), not the :hover/:focus rules that used to gate display.
           z-index matches --z-pop (same tier as .railgroup-pop/.acctmenu) so it clears the app chrome. */
        .lora-trigger-card{position:fixed;z-index:var(--z-pop,60);
          width:240px;max-width:60vw;background:var(--raised);border:1px solid var(--hair);
          border-radius:9px;padding:10px 12px;box-shadow:0 8px 24px rgba(0,0,0,.35);color:var(--text);
          font-size:12.5px;line-height:1.45;white-space:normal}
        .lora-trigger-card strong{display:block;margin-bottom:2px}
        .lora-trigger-card .ltc-trigger{display:inline-block;font-family:monospace;opacity:.75;margin-bottom:4px}
        .lora-trigger-card p{margin:4px 0;opacity:.85}
        .lora-trigger-card .ltc-meta{display:block;margin-top:4px;opacity:.6;text-transform:capitalize}
      `}</style>
      <div className="cardscroll"><div className="card">
        {loadErr && <div className="warn">Couldn’t load this flow from staging — {loadErr}</div>}
        {!flow && !loadErr && <div className="empty"><div className="t">Loading flow…</div></div>}

        {flow && <>
          <div className="flow-head">
            <span className="fav" />
            <div>
              <h1>{name} <span className="verbtag">{String((flow as { categoria?: unknown }).categoria ?? 'flow')}</span></h1>
              <div className="desc">{(flow.nomen || '').includes('—') ? flow.nomen.split('—').slice(1).join('—').trim() : 'Live flow from staging.'}</div>
              {loraName && (
                <div className="sub">
                  Using your <b>{loraName}</b> LoRA — trigger word <span className="mono accent">{preloadPrompt}</span> is included in the prompt below.
                </div>
              )}
              <div className="ports">
                {Object.entries(flow.input?.properties ?? {}).slice(0, 4).map(([k, p]) => <span key={k} className="p">{p.title || humanizeKey(k)}</span>)}
                {' → '}
                {Object.entries(flow.output?.properties ?? {}).map(([k, p]) => <span key={k} className="p">{p.title || humanizeKey(k)}</span>)}
              </div>
            </div>
            <span className="ver mono">v{flow.versio}</span>
            <button
              className={`make-default${makeDefault ? ' on' : ''}`}
              onClick={setAsMakeDefault}
              disabled={bindBusy || makeDefault}
              title={makeDefault ? 'This is your /make default (web + Telegram)' : 'Set as /make default'}
              aria-pressed={makeDefault}
            >
              <Ic name="wand-sparkles" /> {makeDefault ? '/make default' : 'set as /make default'}
            </button>
            <button
              className={`pin${pinned ? ' on' : ''}`}
              onClick={() => setPinned(togglePin({ id, name }))}
              title={pinned ? 'Unpin from rail' : 'Pin to rail'}
              aria-pressed={pinned}
            >
              <Ic name="star" />
            </button>
            {mine && (
              <Link to={`/canvas?modusId=${id}`} className="btn ghost" title="Edit this flow's steps in Canvas">
                <Ic name="workflow" /> Edit in Canvas
              </Link>
            )}
          </div>
          {bindErr && <div className="pub-err">{bindErr}</div>}

          {/* auto-generated from the live input JSON-Schema */}
          {Object.entries(flow.input?.properties ?? {}).map(([k, p]) => {
            const req = required.includes(k);
            const isUri = p.format === 'uri';
            const isNum = p.type === 'integer' || p.type === 'number';
            const hasOptiones = Array.isArray(p.optiones) && p.optiones.length > 0;
            // Free-text string → eligible for Concierge augmentation. Multi-line ones
            // (prompt/lyrics/story/…) render as a textarea; the rest as a text input.
            const isText = p.type === 'string' && !isUri;
            const isLong = isText && /prompt|lyric|story|description|caption|text|message|content/i.test(k);
            // Wired onto every free-text field so the Concierge slides open on focus.
            const assistProps = isText
              ? assist({
                  flowId: id,
                  flowName: name,
                  fieldKey: k,
                  fieldLabel: p.title || k,
                  example: fieldExample(id, k, p.description),
                  hint: p.description,
                  apply: (t: string) => set(k, t),
                })
              : {};
            return (
              <div className="field" key={k}>
                <label>
                  {p.title || humanizeKey(k)} {req ? <span className="req">required</span> : <span className="opt">optional</span>}
                  <span className="ty">{isUri ? `${p.type} · uri` : p.type}</span>
                </label>
                {hasOptiones ? (
                  <select className="inp" value={String(aditus[k] ?? p.default ?? '')} onChange={(e) => set(k, e.target.value)}>
                    {p.optiones!.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                ) : isUri ? (
                  <input className="inp" value={String(aditus[k] ?? '')} placeholder={p.description || 'paste a URL'} onChange={(e) => set(k, e.target.value)} />
                ) : isNum ? (
                  <input className="inp mono" type="number" value={aditus[k] === '' || aditus[k] === undefined ? '' : Number(aditus[k])} placeholder={p.description} onChange={(e) => set(k, e.target.value === '' ? '' : Number(e.target.value))} />
                ) : isLong ? (
                  <HighlightedPromptField
                    value={String(aditus[k] ?? '')}
                    placeholder={p.description}
                    onChange={(v) => set(k, v)}
                    loraMap={loraMap}
                    triggerRe={triggerRe}
                    assistProps={assistProps}
                  />
                ) : (
                  <input className="inp" value={String(aditus[k] ?? '')} placeholder={p.description} onChange={(e) => set(k, e.target.value)} {...assistProps} />
                )}
              </div>
            );
          })}

          {runStatus && (
            <div className="result show">
              <h2><span className="ttdot" /> {runStatus === 'complete' ? 'output' : 'run'}</h2>

              {runStatus === 'failed' && (
                <div className="warn">
                  {dispatchErr ?? runStream.error ?? 'run failed'}
                  {runId && <> — charged {runStream.charged ?? '0'} credits.</>}
                  {' '}
                  <button className="btn-ghost" onClick={doRun}>Retry</button>
                </div>
              )}

              {runId && runStatus !== 'failed' && (
                <div className="stepline">
                  {STAGE_LABELS.map((label, i) => {
                    const st = runStatus === 'complete' ? 'done' : i < runStream.stageIdx ? 'done' : i === runStream.stageIdx ? 'active' : 'pending';
                    return (
                      <div key={i} className={`step ${st}`}>
                        <span className="pip">{st === 'done' && <Ic name="check" />}</span>
                        <div className="st-main">
                          <div className="t">{label}</div>
                          <div className="s">{st === 'active' ? measure(runStream.progressus) : ''}</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              <div className="out">
                <div className={`rimg vis-remote${runStream.exitus ? ' done' : ''}`}>
                  {media?.kind === 'image' && (
                    <img
                      src={media.url}
                      alt=""
                      className="rimg-clickable"
                      onClick={() => setLightbox(true)}
                    />
                  )}
                  {media?.kind === 'video' && <video src={media.url} controls muted loop playsInline />}
                  {media?.kind === 'audio' && <audio src={media.url} controls />}
                  {!runStream.exitus && (
                    <><div className="ph" /><div className="stage"><span className="dots"><span /><span /><span /></span> {runStatus}{runElapsedLabel}</div></>
                  )}
                </div>
                <div className="exitus">
                  <div className="er"><span>run</span><span className="v">{runId ?? '—'}</span></div>
                  <div className="er"><span>status</span><span className="v">{runStatus}{runElapsedLabel}</span></div>
                  {runId && <div className="er"><span>detail</span><span className="v"><Link to={`/run?id=${runId}`}>open run view →</Link></span></div>}
                  {runStream.exitus && Object.entries(runStream.exitus).map(([k, v]) => (
                    <div className="er" key={k}><span>{k}</span><span className="v" style={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis' }}>{String(v)}</span></div>
                  ))}
                  {/* Publish-to-feed — only when the result carries shareable media. */}
                  {runId && mediaFromOutput(runStream.exitus) && (
                    <div className="pub-row">
                      {pub.s === 'done' ? (
                        <span className="pub-done"><Ic name="check" /> In review — track it in the <Link to="/feed">feed</Link>, where it appears once approved.</span>
                      ) : pub.s === 'refused' ? (
                        <span className="pub-err">Not published — {pub.msg}</span>
                      ) : (
                        <>
                          <button className="btn ghost" disabled={pub.s === 'busy'} onClick={() => publishToFeed(runId!)}>
                            <Ic name="rss" /> {pub.s === 'busy' ? 'Publishing…' : 'Publish to feed'}
                          </button>
                          {pub.s === 'err' && <span className="pub-err">{pub.msg}</span>}
                        </>
                      )}
                    </div>
                  )}
                </div>
              </div>
              {lightbox && media?.kind === 'image' && (
                <Lightbox src={media.url} onClose={() => setLightbox(false)} />
              )}
            </div>
          )}

          <div className="runbar"><div className="inner">
            {/* Console run bar — the run row (every run executes on our compute). */}
            {activePurse && (
              <div className="meta-line" style={{ marginTop: 'var(--s2)', fontSize: 'var(--fs-xs)' }}>
                <span className="mono"><Ic name="wallet" /> paying with purse {activePurse.slice(0, 6)}…{activePurse.slice(-4)}</span>
                <button
                  className="btn-ghost"
                  onClick={() => { setActivePurse(null); setActivePurseState(null); }}
                  title="Stop paying from this purse"
                >
                  <Ic name="x" /> use balance
                </button>
              </div>
            )}
            <div className="run-row">
              <div className="quote">
                <span className="q mono">{creditText}</span>
                <span className="qh">{subline}</span>
              </div>
              <button
                className="btn ghost"
                onClick={saveDefaults}
                disabled={affSave.s === 'busy'}
                title="Remember these inputs as your defaults for this flow"
              >
                <Ic name="star" /> {affSave.s === 'done' ? 'saved' : affSave.s === 'busy' ? 'saving…' : 'save defaults'}
              </button>
              <button className="btn-run" onClick={doRun} disabled={!quote?.impetus}>Run <span className="kbd">⌘⏎</span></button>
            </div>
            {affSave.s === 'err' && <div className="pub-err">{affSave.msg}</div>}
          </div></div>
        </>}
      </div></div>
    </AppShell>
  );
}
