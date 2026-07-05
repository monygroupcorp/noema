import { useState, useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AppShell } from '../shell/AppShell';
import { Ic } from '../lib/icons';
import { api, type ModelCard } from '../lib/api';
import { useProjectScope } from '../state/project';
import { ScopeBanner } from '../lib/ScopeBanner';

// Model shelf (train-shelf-spec.md) — the caller's own trained + imported models, from
// GET /v1/me/models. Cards show real provenance (base model, trigger, license, listing
// state). Royalty/run economics don't exist server-side yet (Tier B #5), so they're not
// shown — the shelf reflects only what the backend actually knows.

// Deterministic tile gradient from the model id — distinct-looking cards without
// inventing per-model artwork the backend doesn't have.
function tileBg(id: string): string {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const a = h % 360;
  const b = (a + 40) % 360;
  return `linear-gradient(135deg, hsl(${a} 38% 22%), hsl(${b} 44% 15%))`;
}

const COMMERCIAL_LABEL: Record<NonNullable<ModelCard['commercialUse']>, string> = {
  yes: 'commercial ok',
  no: 'non-commercial',
  conditional: 'conditional',
  unknown: 'license unknown',
};

export function Shelf() {
  const [models, setModels] = useState<ModelCard[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // Import-by-URL panel state (POST /v1/models/import).
  const [showImport, setShowImport] = useState(false);
  const [url, setUrl] = useState('');
  const [genus, setGenus] = useState<'lora' | 'model'>('lora');
  const [imp, setImp] = useState<{ s: 'idle' | 'busy' | 'err'; msg?: string }>({ s: 'idle' });

  // Platform admins get a per-model license reclassify control (PUT /v1/models/:id/license).
  const [admin, setAdmin] = useState(false);
  const [licBusy, setLicBusy] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    api.listMyModels()
      .then((r) => { if (live) setModels(r.models); })
      .catch((e) => { if (live) setErr(e instanceof Error ? e.message : String(e)); });
    api.getMe().then((me) => { if (live) setAdmin(!!me.admin); }).catch(() => {});
    return () => { live = false; };
  }, []);

  async function reclassify(id: string) {
    setLicBusy(id);
    try {
      const { model } = await api.setModelLicense(id, { reclassify: true });
      setModels((cur) => (cur ?? []).map((m) => (m.intellaId === id ? model : m)));
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setLicBusy(null); }
  }

  async function doImport() {
    if (!url.trim()) return;
    setImp({ s: 'busy' });
    try {
      const { model } = await api.importModel({ url: url.trim(), genus });
      setModels((cur) => [model, ...(cur ?? [])]);
      setUrl(''); setImp({ s: 'idle' }); setShowImport(false);
    } catch (e) {
      setImp({ s: 'err', msg: e instanceof Error ? e.message : String(e) });
    }
  }

  const [params] = useSearchParams();
  const scope = useProjectScope(params.get('project'));
  // When scoped to a project, show only its filed models (Provincia.res.modelIds).
  const shown = scope && models ? models.filter((m) => scope.modelIds.includes(m.intellaId)) : models;
  const count = shown?.length ?? 0;

  return (
    <AppShell title="Models">
      <div className="page"><div className="pw wide">
        <div className="pagehead shelf-head">
          <div>
            <div className="noema-kicker" style={{ marginBottom: 8 }}>your models · {models ? `${count} trained` : 'loading…'}</div>
            <h1>Model shelf</h1>
            <div className="sub">What you’ve taught NOEMA — run them, turn them into collections, and publish them.</div>
          </div>
          <div className="shelf-right">
            <button className="btn ghost" onClick={() => setShowImport((v) => !v)}><Ic name="download" /> import by URL</button>
            <Link className="btn" to="/datasets"><Ic name="plus" /> new training</Link>
          </div>
        </div>

        {showImport && (
          <div className="noema-frame" style={{ padding: 'var(--s4)', marginBottom: 'var(--s5)', display: 'flex', flexDirection: 'column', gap: 'var(--s3)' }}>
            <div className="sub">Import a model or LoRA by URL — a Civitai page, a HuggingFace repo, or a direct <span className="mono">.safetensors</span>. It lands here as private, usable in your flows at once.</div>
            <div style={{ display: 'flex', gap: 'var(--s3)', flexWrap: 'wrap' }}>
              <input
                className="inp mono"
                style={{ flex: '1 1 320px' }}
                placeholder="https://civitai.com/models/… · https://huggingface.co/… · https://…/weights.safetensors"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
              />
              <select className="inp mono" style={{ maxWidth: 120 }} value={genus} onChange={(e) => setGenus(e.target.value as 'lora' | 'model')}>
                <option value="lora">lora</option>
                <option value="model">model</option>
              </select>
              <button className="btn accent" onClick={doImport} disabled={imp.s === 'busy' || !url.trim()}>
                {imp.s === 'busy' ? 'Importing…' : 'Import'}
              </button>
            </div>
            {imp.s === 'err' && <div className="warn">{imp.msg}</div>}
          </div>
        )}

        {scope && <ScopeBanner project={scope} noun="models" />}

        {err && <div className="warn">Couldn’t load your models — {err}</div>}
        {!models && !err && <div className="empty"><div className="t">Loading your models…</div></div>}
        {shown && shown.length === 0 && (
          <div className="empty">
            <div className="t">{scope ? `No models filed into ${scope.name} yet` : 'No models yet'}</div>
            <div className="s">Train a LoRA from a <Link to="/datasets">dataset</Link>, or import one by URL — it lands here.</div>
          </div>
        )}

        {shown && shown.length > 0 && (
          <div className="shelfgrid">
            {shown.map((m) => {
              const listed = m.access === 'public';
              return (
                <div key={m.intellaId} className="modelcard">
                  <div className="mc-sample" style={{ background: tileBg(m.intellaId) }}>
                    {m.basis && <span className="mc-ver mono">{m.basis}</span>}
                    <span className={`mc-listed ${listed ? 'on' : 'priv'}`}>
                      {listed ? <><span className="rdot good" /> listed</> : <><Ic name="eye-off" /> private</>}
                    </span>
                  </div>
                  <div className="mc-body">
                    <div className="mc-title"><b>{m.nomen}</b><span className={`mc-kind ${m.genus}`}>{m.genus}</span></div>
                    <div className="mc-meta mono">
                      {m.basis ?? 'model'}
                      {m.trigger && <> · trigger <span className="accent">{m.trigger}</span></>}
                    </div>
                    {(m.license || m.commercialUse) && (
                      <div className="mc-meta mono">
                        {m.license && <span>{m.license}</span>}
                        {m.commercialUse && <> · {COMMERCIAL_LABEL[m.commercialUse]}</>}
                      </div>
                    )}
                    {m.description && <div className="mc-meta">{m.description}</div>}
                    <div className="mc-actions">
                      <Link className="btn ghost" to={`/card?id=${m.intellaId}`}>Use in a flow</Link>
                      <Link className="btn accent" to="/collections"><Ic name="hexagon" /> Collection</Link>
                      {admin && (
                        <button className="btn ghost" onClick={() => reclassify(m.intellaId)} disabled={licBusy === m.intellaId} title="Admin: re-derive license from the base model">
                          {licBusy === m.intellaId ? 'reclassifying…' : 'reclassify license'}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div></div>
    </AppShell>
  );
}
