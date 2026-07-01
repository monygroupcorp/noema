import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { AppShell } from '../shell/AppShell';
import { Ic } from '../lib/icons';
import { api, type Appearance } from '../lib/api';

const SWATCHES = ['#5b8cff', '#8b76d6', '#57c8a6', '#d68f6f', '#d66f9a', '#d6c46f'];
const LOOKS: { key: string; label: string }[] = [
  { key: 'clean', label: 'Clean' }, { key: 'n64', label: 'N64 / low-poly' },
  { key: 'vapor', label: 'Vapor' }, { key: 'editorial', label: 'Editorial' },
];
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

// Upload a file to R2 via the signed-PUT path, return its permanent public URL.
async function uploadAsset(file: File): Promise<string> {
  const { signedUrl, permanentUrl } = await api.signUpload({ filename: file.name, contentType: file.type });
  const put = await fetch(signedUrl, { method: 'PUT', headers: { 'content-type': file.type }, body: file });
  if (!put.ok) throw new Error(`upload failed (${put.status})`);
  return permanentUrl;
}

export function Profile() {
  const [appr, setAppr] = useState<Appearance>({ accent: '#5b8cff', look: 'clean' });
  const [loaded, setLoaded] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    api.getMe()
      .then((me) => { if (live) { if (me.appearance) setAppr((a) => ({ ...a, ...me.appearance })); setLoaded(true); } })
      .catch(() => { if (live) setLoaded(true); });
    return () => { live = false; };
  }, []);

  // Persist a partial change (merges over current appearance) — fire-and-forget.
  // Gated on `loaded` so an early click can't PUT a partial object that wipes the
  // server's other saved fields (setAppearance replaces the whole appearance).
  function save(patch: Partial<Appearance>) {
    if (!loaded) return;
    setAppr((cur) => { const next = { ...cur, ...patch }; api.setAppearance(next).catch((e) => setErr(msg(e))); return next; });
  }

  const accent = appr.accent || '#5b8cff';
  const pageStyle = { ['--accent' as keyof CSSProperties]: accent } as CSSProperties;

  return (
    <AppShell crumb="profile">
      <div className="page" style={pageStyle}><div className="pw">
        <div className="pagehead"><div>
          <h1>Profile · skins</h1>
          <div className="sub">Decorate freely — your skin is how this identity looks. Saved to your account (works anonymously too).</div>
        </div></div>

        {err && <div className="warn" style={{ marginBottom: 'var(--s4)' }}>{err}</div>}

        <div className="sectionhead">Assets</div>
        <div className="sub" style={{ marginBottom: 'var(--s4)' }}>Bring your own — drop an image to upload.</div>
        <AssetSlot label="Banner — click to upload" url={appr.bannerUrl} onUploaded={(u) => save({ bannerUrl: u })} onError={setErr} />
        <div style={{ display: 'flex', gap: 'var(--s4)', marginTop: 'var(--s4)', alignItems: 'flex-end' }}>
          <AssetSlot className="pfp" label="PFP" url={appr.avatarUrl} onUploaded={(u) => save({ avatarUrl: u })} onError={setErr} />
          <AssetSlot style={{ flex: 1 }} label="Background" url={appr.backgroundUrl} onUploaded={(u) => save({ backgroundUrl: u })} onError={setErr} />
        </div>

        <div className="sectionhead">Accent</div>
        <div className="swatches">
          {SWATCHES.map((c) => (
            <span key={c} className={`sw${accent === c ? ' on' : ''}`} style={{ background: c }} onClick={() => save({ accent: c })} />
          ))}
        </div>
        <div className="sub" style={{ marginTop: 'var(--s3)' }}>One signal color — used sparingly.</div>

        <div className="sectionhead">Signature look</div>
        <div className="filters">
          {LOOKS.map((l) => (
            <button key={l.key} className={`fchip${appr.look === l.key ? ' on' : ''}`} onClick={() => save({ look: l.key })}>{l.label}</button>
          ))}
        </div>
        <div className="sub" style={{ marginTop: 'var(--s3)' }}>Heritage: we turn images into video-game-like images.</div>

        <div className="sectionhead">Generate a kit</div>
        <div className="sidecard">
          <div className="mono" style={{ color: 'var(--faint)', fontSize: 'var(--fs-xs)' }}>
            <span className="hemi2 dashed" /> Kit generation is coming — it needs a dedicated <b>profile-kit</b> flow (compose the PS2/low-poly LoRA + an image model). For now, upload your own assets above.
          </div>
          <button className="btn" disabled style={{ marginTop: 'var(--s3)' }}><Ic name="sparkles" /> Generate kit — soon</button>
        </div>
      </div></div>
    </AppShell>
  );
}

function AssetSlot({ label, url, onUploaded, onError, className, style }: {
  label: string; url?: string; onUploaded: (url: string) => void; onError: (e: string) => void;
  className?: string; style?: CSSProperties;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  async function pick(file?: File) {
    if (!file) return;
    setBusy(true);
    try { onUploaded(await uploadAsset(file)); }
    catch (e) { onError(msg(e)); }
    finally { setBusy(false); }
  }
  const bg = url ? { backgroundImage: `url(${url})`, backgroundSize: 'cover', backgroundPosition: 'center' } : undefined;
  return (
    <div className={`assetslot${className ? ` ${className}` : ''}`} style={{ ...style, ...bg }} onClick={() => inputRef.current?.click()}>
      {!url && (busy ? 'Uploading…' : label)}
      <input ref={inputRef} type="file" accept="image/*" hidden onChange={(e) => pick(e.target.files?.[0])} />
    </div>
  );
}
