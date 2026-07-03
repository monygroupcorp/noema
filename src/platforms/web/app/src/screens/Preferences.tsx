import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { AppShell } from '../shell/AppShell';
import { Ic } from '../lib/icons';
import { api, type Generatio, type MeView } from '../lib/api';

// Preferences — portable generation defaults that travel across web · Telegram · API.
// WIRED: the cross-cutting card persists to `generatio` (GET/PUT /v1/me/generatio),
// applied at cast time (style prepends the prompt; negativePrompt fills the flow's
// negative input). The per-command param defaults have a ready backend too
// (GET/PUT /v1/me/affines/:modusId, applied cast-time) — the inline per-command editor
// is the marked next step. MARKED gaps: /animate·/effect·/upscale aren't canon verbs
// yet; "land in / project" needs a Projects entity that doesn't exist; auto-apply model
// needs a model picker + cast-time model resolution.

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function Preferences() {
  const [me, setMe] = useState<MeView | null>(null);
  const [gen, setGen] = useState<Generatio>({});
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const genRef = useRef<Generatio>({});
  genRef.current = gen;
  const loaded = me !== null;

  useEffect(() => {
    let live = true;
    api.getMe().then((m) => { if (live) { setMe(m); setGen(m.generatio ?? {}); } }).catch((e) => { if (live) setErr(msg(e)); });
    return () => { live = false; };
  }, []);

  // Persist the FULL generatio (never a partial — a partial PUT would wipe the other
  // fields). Gated on `loaded` so an early edit can't overwrite not-yet-loaded prefs.
  function commit(next: Generatio) {
    setGen(next);
    if (!loaded) return;
    api.setGeneratio(next).then(() => { setSaved(true); setTimeout(() => setSaved(false), 1500); }).catch((e) => setErr(msg(e)));
  }
  const editLocal = (patch: Partial<Generatio>) => setGen((cur) => ({ ...cur, ...patch }));
  const flush = () => commit(genRef.current);

  // Resolve /make's current model from the caller's bindings (else the canon default).
  const makeModel = me?.bindings.find((b) => b.verb === 'make')?.modusId ?? 'flux-schnell';

  const crumb = <span className="ph-crumb"><Link to="/app">you</Link> <span className="sep">/</span> <b>Preferences</b></span>;
  return (
    <AppShell title={crumb}>
      <div className="page"><div className="pw wide">
        <div className="pref-tabs">
          <Link to="/app" className="pref-tab">Overview</Link>
          <span className="pref-tab on">Preferences</span>
          {saved && <span className="pref-saved mono" style={{ color: 'var(--good, #57c8a6)' }}>✓ saved</span>}
        </div>

        <p className="pref-sub">Your defaults for every generation — they travel with you across <b>web · Telegram · API</b>.</p>
        <div className="pref-honesty mono"><span className="hemi2 dashed" /> custody stays a per-run choice · these are defaults, override inline anytime</div>
        {err && <div className="warn" style={{ marginBottom: 'var(--s4)' }}>{err}</div>}

        {/* cross-cutting defaults — WIRED to generatio */}
        <div className="pref-l noema-kicker">across all commands</div>
        <div className="pref-grid">
          <div className="pref-card">
            <div className="pref-card-h"><Ic name="sparkles" /><b>Style &amp; prompt</b></div>
            <label className="ac-row"><span className="ac-rk mono">default style</span>
              <input className="cer-input" placeholder="e.g. cinematic, cold" value={gen.style ?? ''} onChange={(e) => editLocal({ style: e.target.value || undefined })} onBlur={flush} /></label>
            <label className="ac-row"><span className="ac-rk mono">negative prompt</span>
              <input className="cer-input" placeholder="blurry, text, watermark" value={gen.negativePrompt ?? ''} onChange={(e) => editLocal({ negativePrompt: e.target.value || undefined })} onBlur={flush} /></label>
            <div className="ac-row"><span className="ac-rk mono">auto-apply a model</span>
              <span className="ac-rv mono" style={{ color: 'var(--faint)' }}><span className="hemi2 dashed" /> needs a model picker — coming</span></div>
          </div>
          <div className="pref-card">
            <div className="pref-card-h"><Ic name="send" /><b>Output &amp; delivery</b></div>
            <label className="ac-row"><span className="ac-rk mono">format</span>
              <select className="cer-input" value={gen.outputFormat ?? 'png'} onChange={(e) => commit({ ...gen, outputFormat: e.target.value })}>
                <option value="png">PNG · max quality</option><option value="jpg">JPG</option><option value="webp">WebP</option>
              </select></label>
            <label className="ac-row"><span className="ac-rk mono">telegram: deliver as</span>
              <select className="cer-input" value={gen.telegramDeliverAs ?? 'album'} onChange={(e) => commit({ ...gen, telegramDeliverAs: e.target.value as Generatio['telegramDeliverAs'] })}>
                <option value="album">album</option><option value="individual">individual</option>
              </select></label>
            <div className="ac-row"><span className="ac-rk mono">land in (project)</span>
              <span className="ac-rv mono" style={{ color: 'var(--faint)' }}><span className="hemi2 dashed" /> needs a Projects entity — not built</span></div>
          </div>
        </div>

        {/* per-command defaults — backend ready (affines); inline editor is next */}
        <div className="pref-l noema-kicker">per command</div>
        <div className="pref-note mono" style={{ color: 'var(--faint)', marginBottom: 'var(--s3)' }}>
          <span className="hemi2 ring" /> Per-command param defaults (model · size · steps · cfg · count) persist as <b>affines</b> and apply at cast time — the inline editor lands next. <b>/animate · /effect · /upscale</b> aren't canon verbs yet.
        </div>
        <div className="pref-grid">
          <div className="pref-card">
            <div className="pref-card-h"><span className="accent mono">/make</span><span className="pref-kind">image</span></div>
            <div className="pref-preview"><span className="pp-l mono">resolves to</span><span className="pp-v mono">{makeModel}</span></div>
            <div className="pref-preview"><span className="pp-l mono">rebind</span><span className="pp-v mono">/bind make &lt;flow&gt; · or save a flow with baked defaults</span></div>
          </div>
          {['/animate', '/effect', '/upscale'].map((cmd) => (
            <div key={cmd} className="pref-card" style={{ opacity: 0.6 }}>
              <div className="pref-card-h"><span className="accent mono">{cmd}</span><span className="pref-kind">no canon verb yet</span></div>
              <div className="pref-preview"><span className="pp-l mono">status</span><span className="pp-v mono"><span className="hemi2 dashed" /> needs a flow + canon binding</span></div>
            </div>
          ))}
        </div>
      </div></div>
    </AppShell>
  );
}
