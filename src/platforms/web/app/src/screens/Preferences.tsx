import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { AppShell } from '../shell/AppShell';
import { Ic } from '../lib/icons';
import { api, type Generatio, type MeView, type FlowSummary } from '../lib/api';
import { useProject } from '../state/project';

// Preferences — portable generation defaults that travel across web · Telegram · API.
// WIRED: the cross-cutting card persists to `generatio` (GET/PUT /v1/me/generatio),
// applied at cast time (style prepends the prompt; negativePrompt fills the flow's
// negative input). The per-command param defaults have a ready backend too
// (GET/PUT /v1/me/affines/:modusId, applied cast-time) — the inline per-command editor
// is the marked next step. "land in (project)" is a live picker persisting
// generatio.defaultProjectId (Provincia) — stored + portable; cast-time auto-filing is the
// marked next step. The "default /make flow" picker is WIRED — it rebinds the `make` verb
// (PUT /v1/me/bindings/make), resolved at cast time server-side. MARKED gap: /animate·/effect·
// /upscale aren't canon verbs yet.

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function Preferences() {
  const { projects } = useProject();
  const [me, setMe] = useState<MeView | null>(null);
  const [gen, setGen] = useState<Generatio>({});
  const [flows, setFlows] = useState<FlowSummary[]>([]);
  const [makeModel, setMakeModel] = useState('flux-schnell');
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const genRef = useRef<Generatio>({});
  genRef.current = gen;
  const loaded = me !== null;

  useEffect(() => {
    let live = true;
    api.getMe().then((m) => {
      if (!live) return;
      setMe(m); setGen(m.generatio ?? {});
      setMakeModel(m.bindings.find((b) => b.verb === 'make')?.modusId ?? 'flux-schnell');
    }).catch((e) => { if (live) setErr(msg(e)); });
    // The picker's options — the flow catalogue. Falls back to just the current binding on failure.
    api.listFlows().then((r) => { if (live) setFlows(r.flows); }).catch(() => { /* keep the current binding option */ });
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

  // Spicy mode (18+). Enabling requires a one-time 18+ self-attestation on file; if none is recorded,
  // run a click-through confirmation and POST it (POST /v1/me/attestation) BEFORE persisting the toggle.
  // The server independently rejects spicyMode:true without an attestation (auth.forbidden), surfaced via
  // commit()'s catch. Disabling never needs attestation. Moderation/CSAM scanning runs regardless.
  async function toggleSpicy(on: boolean) {
    if (!on) { commit({ ...genRef.current, spicyMode: false }); return; }
    let attestation = genRef.current.ageAttestation;
    if (!attestation) {
      const ok = window.confirm(
        'Spicy mode unlocks adult-rated (18+) models and relaxes safe-content defaults. Content moderation and CSAM scanning always run regardless. By continuing you attest that you are 18 years of age or older. Continue?',
      );
      if (!ok) return;
      try { attestation = (await api.recordAttestation()).attestation; }
      catch (e) { setErr(msg(e)); return; }
    }
    commit({ ...genRef.current, spicyMode: true, ageAttestation: attestation });
  }

  // Rebind /make to a chosen flow (PUT /v1/me/bindings/make) — optimistic, reverts on error.
  function rebindMake(modusId: string) {
    const prev = makeModel;
    setMakeModel(modusId);
    api.setBinding('make', modusId)
      .then(() => { setSaved(true); setTimeout(() => setSaved(false), 1500); })
      .catch((e) => { setMakeModel(prev); setErr(msg(e)); });
  }

  const crumb = <span className="ph-crumb"><Link to="/account">Settings</Link> <span className="sep">/</span> <b>Preferences</b></span>;
  return (
    <AppShell title={crumb}>
      <div className="page"><div className="pw wide">
        <div className="pref-tabs">
          <Link to="/account" className="pref-tab">Settings</Link>
          <span className="pref-tab on">Preferences</span>
          {saved && <span className="pref-saved mono" style={{ color: 'var(--good, #57c8a6)' }}>✓ saved</span>}
        </div>

        <p className="pref-sub">Your defaults for every generation — they travel with you across <b>web · Telegram · API</b>.</p>
        <div className="pref-honesty mono"><span className="hemi2 dashed" /> custody stays a per-run choice · these are defaults, override inline anytime</div>
        {err && <div className="warn" style={{ marginBottom: 'var(--s4)' }}>{err}</div>}

        {/* cross-cutting defaults — WIRED to generatio */}
        <div className="pref-grid">
          <div className="pref-card">
            <div className="pref-card-h"><Ic name="sparkles" /><b>Style &amp; prompt</b></div>
            <label className="ac-row"><span className="ac-rk mono">default style</span>
              <input className="cer-input" placeholder="e.g. cinematic, cold" value={gen.style ?? ''} onChange={(e) => editLocal({ style: e.target.value || undefined })} onBlur={flush} /></label>
            <label className="ac-row"><span className="ac-rk mono">negative prompt</span>
              <input className="cer-input" placeholder="blurry, text, watermark" value={gen.negativePrompt ?? ''} onChange={(e) => editLocal({ negativePrompt: e.target.value || undefined })} onBlur={flush} /></label>
            <label className="ac-row"><span className="ac-rk mono">default /make flow</span>
              <select className="cer-input" value={makeModel} onChange={(e) => rebindMake(e.target.value)}>
                {!flows.some((f) => f.id === makeModel) && <option value={makeModel}>{makeModel}</option>}
                {flows.map((f) => <option key={f.id} value={f.id}>{f.nomen ?? f.id}</option>)}
              </select></label>
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
            <label className="ac-row"><span className="ac-rk mono">land in (project)</span>
              <select className="cer-input" value={gen.defaultProjectId ?? ''} onChange={(e) => commit({ ...gen, defaultProjectId: e.target.value || undefined })}>
                <option value="">— none (unfiled) —</option>
                {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select></label>
          </div>
          <div className="pref-card">
            <div className="pref-card-h"><Ic name="send" /><b>Private generation</b></div>
            <label className="ac-row"><span className="ac-rk mono">private outputs</span>
              <input type="checkbox" checked={gen.privateOutputs ?? false} onChange={(e) => commit({ ...genRef.current, privateOutputs: e.target.checked })} /></label>
            <div className="pref-note mono" style={{ color: 'var(--faint)' }}>
              <span className="hemi2 dashed" /> Outputs of new runs are visible only to you, through expiring links. Publishing or minting one later makes that copy public. Runs you have already made stay as they are.
            </div>
          </div>
          <div className="pref-card">
            <div className="pref-card-h"><Ic name="sparkles" /><b>Spicy mode (18+)</b></div>
            <label className="ac-row"><span className="ac-rk mono">adult content</span>
              <input type="checkbox" checked={gen.spicyMode ?? false} onChange={(e) => toggleSpicy(e.target.checked)} /></label>
            <div className="pref-note mono" style={{ color: 'var(--faint)' }}>
              <span className="hemi2 dashed" /> Unlocks adult-rated models, willing-model chat routing, and relaxed safe-content defaults. Requires a one-time 18+ attestation. Content moderation &amp; CSAM scanning always run regardless.
            </div>
          </div>
        </div>

        {/* per-command defaults — backend ready (affines); inline editor is next */}
        <div className="pref-note mono" style={{ color: 'var(--faint)', marginBottom: 'var(--s3)' }}>
          <span className="hemi2 ring" /> Per-command param defaults (model · size · steps · cfg · count) persist as <b>affines</b> and apply at cast time — the inline editor lands next. <b>/animate · /effect · /upscale</b> aren't canon verbs yet.
        </div>
        <div className="pref-grid">
          <div className="pref-card">
            <div className="pref-card-h"><span className="accent mono">/make</span><span className="pref-kind">image</span></div>
            <div className="pref-preview"><span className="pp-l mono">resolves to</span><span className="pp-v mono">{makeModel}</span></div>
            <div className="pref-preview"><span className="pp-l mono">rebind</span><span className="pp-v mono">the <b>default /make flow</b> picker above · or /bind make &lt;flow&gt;</span></div>
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
