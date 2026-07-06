import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { AppShell } from '../shell/AppShell';
import { Ic } from '../lib/icons';
import {
  api, SecretsUnavailableError, SECRET_PROVIDERS, SECRET_PROVIDER_LABEL,
  type Appearance, type SecretProvider, type Purse,
} from '../lib/api';
import { useIdentity } from '../state/identity';
import { useSession } from '../state/session';
import { connectWallet } from '../lib/wallet';

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
  // undefined until /me loads (older servers omit it) → the panel assumes available; false = store
  // unconfigured → the panel shows "unavailable" proactively without a failed connect (F3).
  const [secretsAvailable, setSecretsAvailable] = useState<boolean>();
  const { ident } = useIdentity();
  const { session } = useSession();
  const anon = ident.funding === 'bearer';

  useEffect(() => {
    let live = true;
    api.getMe()
      .then((me) => {
        if (!live) return;
        if (me.appearance) setAppr((a) => ({ ...a, ...me.appearance }));
        setSecrets(me.secrets);
        setSecretsAvailable(me.secretsAvailable);
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
          <h1>Profile</h1>
          <div className="sub">Decorate freely — this is how your identity looks across NOEMA. Saved to your account (works anonymously too).</div>
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

        <BackupRecovery signedIn={!!session} />

        {loaded && <ConnectedAccounts initial={secrets} available={secretsAvailable} anon={anon} />}

        <Purses signedIn={!!session} />
      </div></div>
    </AppShell>
  );
}

// ── Purses (owned Bursa purses, §7) ──────────────────────────────────────────
// Convert part of your credit balance into a shareable bearer token — an "owned purse".
// Whoever holds the token can spend it on runs (the widget's entrance), and you keep a
// dashboard over the drain (you see the balance fall, never who spent it). Reclaim pulls
// leftover credits back to your balance; revoke drains + retires the token. Identified
// accounts only — the backend refuses anonymous/purse callers, so we gate on a real session.
function Purses({ signedIn }: { signedIn: boolean }) {
  const [purses, setPurses] = useState<Purse[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [credits, setCredits] = useState('');
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    if (!signedIn) { setPurses([]); return; }
    let live = true;
    api.listPurses()
      .then((r) => { if (live) setPurses(r.purses); })
      .catch((e) => { if (live) { setErr(msg(e)); setPurses([]); } });
    return () => { live = false; };
  }, [signedIn]);

  async function mint() {
    const n = Number(credits);
    if (!Number.isInteger(n) || n <= 0 || busy) return;
    setBusy(true); setErr(null);
    try {
      const purse = await api.mintPurse({ credits: n, ...(label.trim() ? { label: label.trim() } : {}) });
      setPurses((cur) => [purse, ...(cur ?? [])]);
      setCredits(''); setLabel('');
    } catch (e) { setErr(msg(e)); }
    finally { setBusy(false); }
  }

  // Reclaim (leave the token, pull leftover back) or revoke (drain + retire). Both refresh the row.
  async function act(token: string, verb: 'reclaim' | 'revoke') {
    setBusy(true); setErr(null);
    try {
      await (verb === 'reclaim' ? api.reclaimPurse(token) : api.revokePurse(token));
      const r = await api.listPurses();
      setPurses(r.purses);
    } catch (e) { setErr(msg(e)); }
    finally { setBusy(false); }
  }

  async function copyToken(token: string) {
    try { await navigator.clipboard.writeText(token); setCopied(token); setTimeout(() => setCopied((c) => (c === token ? null : c)), 1500); }
    catch { /* clipboard blocked — the token is still visible in the row */ }
  }

  if (!signedIn) {
    return (
      <>
        <div className="sectionhead">Purses</div>
        <div className="sub">Sign in to a named account to mint shareable purses — a bearer token others can spend on your credits. Anonymous sessions can’t own purses.</div>
      </>
    );
  }

  return (
    <>
      <div className="sectionhead">Purses</div>
      <div className="sub" style={{ marginBottom: 'var(--s4)' }}>
        Turn some of your credits into a shareable <b>bearer token</b>. Anyone with the token spends it on runs —
        you keep a dashboard over the balance (you see it drain, never who spent it). Reclaim pulls leftover credits back; revoke retires it.
      </div>

      {err && <div className="warn" style={{ marginBottom: 'var(--s4)' }}>{err}</div>}

      <div className="byo-row">
        <div className="byo-body byo-connect">
          <input className="byo-input" type="number" min={1} step={1} inputMode="numeric" placeholder="Credits"
            value={credits} onChange={(e) => setCredits(e.target.value)} style={{ maxWidth: 140 }} />
          <input className="byo-input" type="text" placeholder="Label (optional, e.g. “discord mods”)"
            value={label} maxLength={120} onChange={(e) => setLabel(e.target.value)} />
          <button className="btn" disabled={busy || !(Number(credits) > 0)} onClick={mint}>
            {busy ? 'Minting…' : `Mint${Number(credits) > 0 ? ` — ${Number(credits)} cr` : ''}`}
          </button>
        </div>
        <div className="sub byo-note">Minting spends the credits from your balance now. The token below is the only credential to share — treat it like a password.</div>
      </div>

      {purses === null && <div className="sub" style={{ marginTop: 'var(--s3)' }}>Loading your purses…</div>}
      {purses !== null && purses.length === 0 && <div className="sub" style={{ marginTop: 'var(--s3)' }}>No purses yet — mint one above.</div>}

      {purses !== null && purses.map((p) => {
        const revoked = p.status === 'revoked';
        return (
          <div key={p.token} className="byo-row" style={revoked ? { opacity: 0.6 } : undefined}>
            <div className="byo-head">
              <span className="byo-prov">{p.label || 'Untitled purse'}</span>
              <span className={`byo-state ${revoked ? 'absent' : 'connected'}`}>{revoked ? 'revoked' : `${p.credits} cr left`}</span>
            </div>
            <div className="byo-body">
              <code className="mono" style={{ fontSize: 'var(--fs-xs)', color: 'var(--faint)', wordBreak: 'break-all' }}>{p.token}</code>
            </div>
            {!revoked && (
              <div className="byo-body byo-connect" style={{ gap: 'var(--s3)' }}>
                <button className="btn-ghost" disabled={busy} onClick={() => copyToken(p.token)}>{copied === p.token ? 'Copied ✓' : 'Copy token'}</button>
                <button className="btn-ghost" disabled={busy} onClick={() => act(p.token, 'reclaim')} title="Pull leftover credits back to your balance">Reclaim</button>
                <button className="btn-ghost" disabled={busy} onClick={() => act(p.token, 'revoke')} title="Drain and retire this purse">Revoke</button>
              </div>
            )}
          </div>
        );
      })}
    </>
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

// ── Account backup & recovery (wallet + Telegram channels) ────────────────────
// Bind a channel to the soul so a forgotten password is recoverable — there's no email
// reset. Wallet: sign a challenge → a `'web'` persona on the same anima. Telegram: tap a
// deep link → the bot re-points your Telegram persona at this account. Both then let you
// log straight in from the sign-in screen (wallet sig / bot `/recover` code).
function BackupRecovery({ signedIn }: { signedIn: boolean }) {
  const anyLinked = signedIn;
  return (
    <>
      <div className="sectionhead">Account backup &amp; recovery</div>
      {!anyLinked ? (
        <div className="sub">Sign in to a username account to add a wallet or Telegram backup — it’s how you get back in if you forget your password. There’s no email reset.</div>
      ) : (
        <>
          <div className="sub" style={{ marginBottom: 'var(--s4)' }}>
            Add at least one backup. Forget your password and you can recover from the sign-in
            screen with a linked channel — no email, no reset links.
          </div>
          <WalletRow />
          <TelegramRow />
        </>
      )}
    </>
  );
}

function WalletRow() {
  const [wallets, setWallets] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [rowErr, setRowErr] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    api.auth.listWallets().then((r) => { if (live) setWallets(r.wallets); }).catch(() => { if (live) setWallets([]); });
    return () => { live = false; };
  }, []);

  const [note, setNote] = useState<string | null>(null);

  async function connect() {
    if (busy) return;
    setBusy(true); setRowErr(null); setNote(null);
    try {
      const wallet = await connectWallet();
      const { token, statement } = await api.auth.walletChallenge(wallet.address);
      const signature = await wallet.signMessage(statement);
      const { address, moved } = await api.auth.walletLink(token, signature);
      setWallets((w) => Array.from(new Set([...(w ?? []), address])));
      if (moved) setNote('This wallet was linked to another account — its recovery now points here.');
    } catch (e) {
      setRowErr(msg(e));
    } finally { setBusy(false); }
  }

  const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
  const linked = (wallets?.length ?? 0) > 0;

  return (
    <div className="byo-row">
      <div className="byo-head">
        <span className="byo-prov">Recovery wallet</span>
        <span className={`byo-state ${linked ? 'connected' : 'absent'}`}>{linked ? 'linked' : 'not linked'}</span>
      </div>
      {linked && <div className="byo-body"><span className="sub mono">{wallets!.map(short).join(', ')}</span></div>}
      <div className="byo-body byo-connect">
        <button className="btn" disabled={busy} onClick={connect}>
          {busy ? 'Waiting for wallet…' : linked ? 'Link another wallet' : 'Connect a wallet'}
        </button>
      </div>
      {note && <div className="sub byo-note">{note}</div>}
      {rowErr && <div className="warn byo-warn">{rowErr}</div>}
    </div>
  );
}

function TelegramRow() {
  const [linked, setLinked] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [rowErr, setRowErr] = useState<string | null>(null);
  const [prompted, setPrompted] = useState(false);   // showed the deep link, awaiting a refresh

  function refresh() {
    api.auth.telegramStatus().then((r) => setLinked(r.linked)).catch(() => setLinked(false));
  }
  useEffect(() => { refresh(); }, []);

  async function link() {
    if (busy) return;
    setBusy(true); setRowErr(null);
    try {
      const { deepLink } = await api.auth.telegramChallenge();
      if (deepLink) window.open(deepLink, '_blank', 'noopener');
      setPrompted(true);
    } catch (e) {
      setRowErr(msg(e));
    } finally { setBusy(false); }
  }

  return (
    <div className="byo-row">
      <div className="byo-head">
        <span className="byo-prov">Recovery Telegram</span>
        <span className={`byo-state ${linked ? 'connected' : 'absent'}`}>{linked === null ? '…' : linked ? 'linked' : 'not linked'}</span>
      </div>
      <div className="byo-body byo-connect">
        <button className="btn" disabled={busy} onClick={link}>
          {busy ? 'Opening Telegram…' : linked ? 'Re-link Telegram' : 'Link Telegram'}
        </button>
        {prompted && <button className="btn-ghost" onClick={refresh}>I’ve tapped Start — refresh</button>}
      </div>
      {prompted && <div className="sub byo-note">Opened Telegram — tap <b>Start</b> in the bot, then hit refresh. Later, forgot your password? Send <b>/recover</b> to the bot for a code.</div>}
      {rowErr && <div className="warn byo-warn">{rowErr}</div>}
    </div>
  );
}

function ConnectedAccounts({ initial, available, anon }: {
  initial?: Record<SecretProvider, 'connected' | 'absent'>; available?: boolean; anon: boolean;
}) {
  // Seeded from /me (`available === false` → store unconfigured, known before any attempt) and also
  // flipped reactively if a connect/disconnect reveals it (belt-and-suspenders for older servers that
  // omit `secretsAvailable`).
  const [unavailable, setUnavailable] = useState(available === false);

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
