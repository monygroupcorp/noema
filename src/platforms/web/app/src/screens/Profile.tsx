import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { AppShell } from '../shell/AppShell';
import { Ic } from '../lib/icons';
import {
  api, SecretsUnavailableError, SECRET_PROVIDERS, SECRET_PROVIDER_LABEL,
  type Appearance, type SecretProvider,
} from '../lib/api';
import { useIdentity } from '../state/identity';

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
  const [secrets, setSecrets] = useState<Record<SecretProvider, 'connected' | 'absent'>>();
  const { ident } = useIdentity();
  const anon = ident.funding === 'bearer';

  useEffect(() => {
    let live = true;
    api.getMe()
      .then((me) => {
        if (!live) return;
        if (me.appearance) setAppr((a) => ({ ...a, ...me.appearance }));
        setSecrets(me.secrets);
        setLoaded(true);
      })
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

        {loaded && <ConnectedAccounts initial={secrets} anon={anon} />}
      </div></div>
    </AppShell>
  );
}

// ── Connected accounts (BYO gated-origin secrets) ────────────────────────────
// Connect a Civitai/HuggingFace token so gated model/LoRA imports can scrape metadata
// and download weights. The token is sealed server-side and never returned — we only
// ever see per-provider presence. Anonymous (purse) callers get a deanonymization
// caution both before and after connecting; connecting is still their choice.
const IDLE_WINDOWS = [30, 90, 180, 365];

function daysUntil(iso?: string): number | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - Date.now();
  return ms > 0 ? Math.max(1, Math.round(ms / 86_400_000)) : 0;
}

function ConnectedAccounts({ initial, anon }: {
  initial?: Record<SecretProvider, 'connected' | 'absent'>; anon: boolean;
}) {
  // Set once a connect/disconnect reveals the store isn't configured on this deployment.
  const [unavailable, setUnavailable] = useState(false);

  return (
    <>
      <div className="sectionhead">Connected accounts</div>
      {unavailable ? (
        <div className="sub">Connecting Civitai / HuggingFace accounts isn’t available on this deployment.</div>
      ) : (
        <>
          <div className="sub" style={{ marginBottom: 'var(--s4)' }}>
            Connect a Civitai or HuggingFace token to import gated models and LoRAs. Your token is
            stored sealed — it is never shown again, only its connection state.
          </div>
          {SECRET_PROVIDERS.map((p) => (
            <SecretRow key={p} provider={p} initialStatus={initial?.[p] ?? 'absent'} anon={anon}
              onUnavailable={() => setUnavailable(true)} />
          ))}
        </>
      )}
    </>
  );
}

function SecretRow({ provider, initialStatus, anon, onUnavailable }: {
  provider: SecretProvider; initialStatus: 'connected' | 'absent'; anon: boolean; onUnavailable: () => void;
}) {
  const [status, setStatus] = useState(initialStatus);
  const [expiresAt, setExpiresAt] = useState<string>();
  const [token, setToken] = useState('');
  const [idleDays, setIdleDays] = useState(90);
  const [busy, setBusy] = useState(false);
  const [rowErr, setRowErr] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const label = SECRET_PROVIDER_LABEL[provider];

  async function connect() {
    if (!token.trim() || busy) return;
    setBusy(true); setRowErr(null);
    try {
      const v = await api.putSecret(provider, token.trim(), idleDays);
      setToken('');                       // drop the token from state the instant it's sealed
      setStatus('connected');
      setExpiresAt(v.expiresAt);
      setWarning(v.warning ?? null);      // authoritative deanon caution for anon callers
    } catch (e) {
      if (e instanceof SecretsUnavailableError) { onUnavailable(); return; }
      setRowErr(msg(e));
    } finally { setBusy(false); }
  }

  async function disconnect() {
    if (busy) return;
    setBusy(true); setRowErr(null);
    try {
      await api.removeSecret(provider);
      setStatus('absent'); setExpiresAt(undefined); setWarning(null);
    } catch (e) {
      if (e instanceof SecretsUnavailableError) { onUnavailable(); return; }
      setRowErr(msg(e));
    } finally { setBusy(false); }
  }

  const days = daysUntil(expiresAt);

  return (
    <div className="byo-row">
      <div className="byo-head">
        <span className="byo-prov">{label}</span>
        <span className={`byo-state ${status}`}>{status === 'connected' ? 'connected' : 'not connected'}</span>
      </div>

      {status === 'connected' ? (
        <div className="byo-body">
          <span className="sub">{days != null ? `expires in ${days} day${days === 1 ? '' : 's'} · renews on use` : 'renews on each use'}</span>
          <button className="btn-ghost" disabled={busy} onClick={disconnect}>{busy ? '…' : 'Disconnect'}</button>
        </div>
      ) : (
        <>
          <div className="byo-body byo-connect">
            <input className="byo-input" type="password" autoComplete="off" placeholder={`${label} API token`}
              value={token} onChange={(e) => setToken(e.target.value)} />
            <select className="byo-input byo-idle" value={idleDays} onChange={(e) => setIdleDays(Number(e.target.value))} title="Idle-expiry window">
              {IDLE_WINDOWS.map((d) => <option key={d} value={d}>{d} days</option>)}
            </select>
            <button className="btn" disabled={busy || !token.trim()} onClick={connect}>{busy ? 'Connecting…' : 'Connect'}</button>
          </div>
          <div className="sub byo-note">Expires after the idle window if unused; each import renews it. Use a minimally-scoped token and rotate it.</div>
          {anon && (
            <div className="warn byo-warn">
              Connecting a {label} token links that account to this anonymous session on our backend,
              weakening your anonymity. It’s your choice — use a token scoped to only what you need, and rotate it.
            </div>
          )}
        </>
      )}

      {warning && (
        <div className="warn byo-warn">
          <span>{warning}</span>
          <button className="byo-dismiss" onClick={() => setWarning(null)} aria-label="Dismiss">✕</button>
        </div>
      )}
      {rowErr && <div className="warn byo-warn">{rowErr}</div>}
    </div>
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
