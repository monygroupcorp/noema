import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AppShell } from '../shell/AppShell';
import { Ic } from '../lib/icons';
import { useIdentity } from '../state/identity';
import { api, setActivePurse, getActivePurse, type ArcanumConfig } from '../lib/api';
import {
  computeCommitment,
  computeNullifierHash,
  generateNote,
  generateSpendProof,
} from '../lib/arcanum';
import {
  readVault,
  addNote,
  markNoteSpent,
  addPurse,
  setPurseCredits,
  exportVault,
  importVault,
  type VaultNote,
  type VaultPurse,
} from '../lib/vault';

// The recovery-phrase panel stays DISPLAY-ONLY for v1 (decision 2): the real backup is the
// JSON export below. BIP39 encoding of the store is a follow-up, not a blocker.
const PHRASE = ['harbor', 'ember', 'quartz', 'meadow', 'cipher', 'lantern', 'tundra', 'violet', 'anchor', 'pollen', 'cobalt', 'marrow'];

type Busy = { kind: 'idle' } | { kind: 'funding' } | { kind: 'minting'; nullifier: string };

function short(hex: string, head = 8, tail = 6) {
  return hex.length > head + tail ? `${hex.slice(0, head)}…${hex.slice(-tail)}` : hex;
}

function Secret({ k, value, secret }: { k: string; value: string; secret?: boolean }) {
  const [shown, setShown] = useState(!secret);
  return (
    <div className="secret">
      <span className="k">{k}</span>
      {shown
        ? <span className="val mono">{value}</span>
        : <span className="val hidden" onClick={() => setShown(true)} style={{ cursor: 'pointer' }}>•••• •••• tap to reveal</span>}
    </div>
  );
}

export function Vault() {
  const { ident } = useIdentity();
  const signedIn = ident.funding === 'named';

  const [notes, setNotes] = useState<VaultNote[]>([]);
  const [purses, setPurses] = useState<VaultPurse[]>([]);
  const [active, setActive] = useState<string | null>(getActivePurse());
  const [config, setConfig] = useState<ArcanumConfig | null>(null);
  const [configErr, setConfigErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<Busy>({ kind: 'idle' });
  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [fundAmt, setFundAmt] = useState('500');
  const [revealed, setRevealed] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState('');

  const reload = useCallback(() => {
    const v = readVault();
    setNotes(v.notes);
    setPurses(v.purses);
    setActive(getActivePurse());
  }, []);

  useEffect(() => { reload(); }, [reload]);

  // Prover discovery. ready=false → the whole mint path stays disabled (no fiction).
  useEffect(() => {
    let live = true;
    api.arcanum.config()
      .then((c) => { if (live) { setConfig(c); setConfigErr(null); } })
      .catch((e) => { if (live) setConfigErr(e instanceof Error ? e.message : String(e)); });
    return () => { live = false; };
  }, []);

  // Watch: refresh each stored purse's live balance (best-effort; a 404 leaves the cached value).
  const purseKeys = purses.map((p) => p.token).join(',');
  useEffect(() => {
    let live = true;
    (async () => {
      for (const p of readVault().purses) {
        try {
          const r = await api.arcanum.getPurse(p.token);
          if (!live) return;
          setPurseCredits(p.token, r.credits);
        } catch { /* keep cached balance */ }
      }
      if (live) reload();
    })();
    return () => { live = false; };
  }, [purseKeys, reload]);

  const unspent = useMemo(() => notes.filter((n) => !n.spent), [notes]);
  const canMint = !!config?.ready;
  const totalPurseCredits = useMemo(
    () => purses.reduce((sum, p) => { try { return sum + BigInt(p.credits); } catch { return sum; } }, 0n),
    [purses],
  );

  // ── Fund a note: signed-in path (POST /arcanum/issue). Client generates the secret;
  // only the commitment is sent. The debit converts identified balance → an anon note. ──
  async function fundNote() {
    setErr(null); setNotice(null);
    let valor: bigint;
    try {
      valor = BigInt(fundAmt.trim());
      if (valor <= 0n) throw new Error();
    } catch {
      setErr('Enter a whole number of credits greater than zero.');
      return;
    }
    setBusy({ kind: 'funding' });
    try {
      const note = generateNote(valor);
      const commitment = await computeCommitment(note.nullifier, note.secret);
      const nullifierHash = await computeNullifierHash(note.nullifier);
      const resp = await api.arcanum.issue({ valor: valor.toString(), commitment, nullifier: note.nullifier });
      const stored: VaultNote = {
        nullifier: note.nullifier,
        secret: note.secret,
        commitment,
        nullifierHash,
        valor: valor.toString(),
        leafIndex: resp.note.leafIndex,
        spent: false,
        createdAt: Date.now(),
      };
      addNote(stored);
      reload();
      setNotice('Note funded. Export your vault before minting — these secrets exist only in this browser.');
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy({ kind: 'idle' });
    }
  }

  // ── Mint a purse: refresh the Merkle proof (root moves as the tree grows) → prove →
  // POST /arcanum/purse → store the token, THEN mark the note spent. Storing the purse
  // first means a crash after mint can't lose the token; a 409 means the note was already
  // consumed, so we mark it spent locally (the double-spend guard). ──
  async function mintPurse(note: VaultNote) {
    if (!config?.ready || !config.zkeyUrl) {
      setErr('The proving ceremony is not finalized yet — minting is unavailable.');
      return;
    }
    setErr(null); setNotice(null);
    setBusy({ kind: 'minting', nullifier: note.nullifier });
    try {
      const { proof } = await api.arcanum.treeProof(note.leafIndex);
      const spendProof = await generateSpendProof(
        { nullifier: note.nullifier, secret: note.secret, valor: BigInt(note.valor), leafIndex: note.leafIndex },
        { root: proof.root, leafIndex: proof.leafIndex, pathElements: proof.pathElements, pathIndices: proof.pathIndices },
        '0', // no execution to bind for a mint — see generateSpendProof docstring
        { wasmUrl: config.wasmUrl, zkeyUrl: config.zkeyUrl },
      );
      const { token, credits } = await api.arcanum.mintPurse(spendProof);
      addPurse({ token, credits, createdAt: Date.now() });
      markNoteSpent(note.nullifier);
      reload();
      setNotice(`Purse minted — ${credits} credits. The note is spent.`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/409|already spent/i.test(msg)) {
        markNoteSpent(note.nullifier);
        reload();
        setErr('This note was already spent. Marked it spent locally — check your purses.');
      } else {
        setErr(msg);
      }
    } finally {
      setBusy({ kind: 'idle' });
    }
  }

  function usePurse(token: string) {
    setActivePurse(token);
    setActive(token);
    setNotice('Runs will now pay from this purse until you clear it.');
  }
  function clearActive() {
    setActivePurse(null);
    setActive(null);
  }

  function doExport() {
    const blob = new Blob([exportVault()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `noema-vault-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }
  function doImport() {
    setErr(null); setNotice(null);
    try {
      importVault(importText);
      setImportText('');
      setImportOpen(false);
      reload();
      setNotice('Vault restored.');
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  const context = (
    <>
      <div className="csec">
        <div className="ctitle">What you hold vs what we store</div>
        <div className="meta-line"><span>you hold</span><span className="v">nullifier · secret · purse token</span></div>
        <div className="meta-line"><span>we store</span><span className="v">commitment · spent-nullifier</span></div>
        <div className="meta-line"><span>link between</span><span className="v">none</span></div>
      </div>
      <div className="csec">
        <div className="ctitle">Purse</div>
        <div className="meta-line"><span>balance</span><span className="v mono">{totalPurseCredits.toString()} credits</span></div>
        <div className="meta-line"><span>purses</span><span className="v mono">{purses.length}</span></div>
        <div className="meta-line"><span>paying with</span><span className="v mono">{active ? short(active, 6, 4) : 'identified balance'}</span></div>
      </div>
    </>
  );

  return (
    <AppShell crumb="vault" context={context}>
      <div className="page"><div className="pw">
        <div className="pagehead"><div>
          <h1>Vault</h1>
          <div className="sub">Anonymous credit. Every secret below exists only in this browser — there is no recovery. Export it before you rely on it.</div>
        </div></div>

        {err && <div className="warn" role="alert">{err}</div>}
        {notice && <div className="csec" style={{ borderColor: 'var(--accent)' }}>{notice}</div>}
        {configErr && <div className="warn">Couldn’t reach the anonymous-credit service — {configErr}</div>}

        {/* Honesty gate: the ceremony must be finalized before any note can be minted. */}
        {config && !config.ready && (
          <div className="warn">
            The trusted-setup ceremony isn’t finalized, so minting anonymous purses is disabled here.{' '}
            <Link to="/ceremony">See the ceremony ▸</Link>
          </div>
        )}

        {/* ── Purses ─────────────────────────────────────────────────────────── */}
        <div className="sectionhead">Purses</div>
        {purses.length === 0 ? (
          <div className="csec">No purses yet. Fund a note, then mint a purse to spend anonymously.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s2)' }}>
            {purses.map((p) => {
              const isActive = active === p.token;
              return (
                <div key={p.token} className="csec" style={isActive ? { borderColor: 'var(--accent)' } : undefined}>
                  <div className="meta-line">
                    <span className="mono">{short(p.token, 8, 6)}</span>
                    <span className="v mono">{p.credits} credits</span>
                  </div>
                  <div style={{ display: 'flex', gap: 'var(--s2)', marginTop: 'var(--s2)' }}>
                    {isActive ? (
                      <button className="btn-ghost" onClick={clearActive}><Ic name="x" /> Stop using</button>
                    ) : (
                      <button className="btn" onClick={() => usePurse(p.token)}><Ic name="wallet" /> Use this purse</button>
                    )}
                    <button className="btn-ghost" onClick={() => { navigator.clipboard?.writeText(p.token); setNotice('Purse token copied.'); }}>
                      <Ic name="arrow-up" /> Copy token
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* ── Notes ──────────────────────────────────────────────────────────── */}
        <div className="sectionhead">Funded notes</div>
        {signedIn ? (
          <div className="csec">
            <div className="meta-line"><span>fund a new note (credits)</span></div>
            <div style={{ display: 'flex', gap: 'var(--s2)', marginTop: 'var(--s2)' }}>
              <input
                className="inp mono"
                type="number"
                min={1}
                value={fundAmt}
                onChange={(e) => setFundAmt(e.target.value)}
                style={{ maxWidth: 160 }}
              />
              <button className="btn" onClick={fundNote} disabled={busy.kind !== 'idle'}>
                <Ic name="plus" /> {busy.kind === 'funding' ? 'Funding…' : 'Fund note'}
              </button>
            </div>
            <div className="warn" style={{ marginTop: 'var(--s3)' }}>
              We cannot recover this. The moment a note is funded its secret lives only here — export your vault before you continue.
            </div>
          </div>
        ) : (
          <div className="csec">
            Funding a note converts identified credits into an anonymous note, so it needs a signed-in account.{' '}
            <Link to="/keyring">Sign in ▸</Link>
          </div>
        )}

        {unspent.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s2)', marginTop: 'var(--s3)' }}>
            {unspent.map((n) => {
              const minting = busy.kind === 'minting' && busy.nullifier === n.nullifier;
              return (
                <div key={n.nullifier} className="csec">
                  <div className="meta-line">
                    <span className="mono">{short(n.commitment)}</span>
                    <span className="v mono">{n.valor} credits</span>
                  </div>
                  <div className="meta-line"><span>leaf</span><span className="v mono">{n.leafIndex}</span></div>
                  <div style={{ marginTop: 'var(--s2)' }}>
                    <button className="btn" onClick={() => mintPurse(n)} disabled={!canMint || busy.kind !== 'idle'}>
                      <Ic name="coins" /> {minting ? 'Proving… (takes a few seconds)' : 'Mint purse'}
                    </button>
                    {!canMint && <span className="mono" style={{ marginLeft: 'var(--s2)', opacity: 0.7 }}>ceremony not finalized</span>}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* ── Secrets (most recent note) ─────────────────────────────────────── */}
        {notes[0] && (
          <>
            <div className="sectionhead">Secrets · latest note</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s2)' }}>
              <Secret k="commitment" value={notes[0].commitment} />
              <Secret k="nullifier" value={notes[0].nullifier} secret />
              <Secret k="secret" value={notes[0].secret} secret />
            </div>
          </>
        )}

        {/* ── Backup: export / import the whole store ─────────────────────────── */}
        <div className="sectionhead">Backup</div>
        <div className="warn">This JSON is your only recovery. Anyone who holds it holds your credit — store it offline.</div>
        <div style={{ display: 'flex', gap: 'var(--s2)', marginTop: 'var(--s3)' }}>
          <button className="btn" onClick={doExport}><Ic name="download" /> Export vault</button>
          <button className="btn-ghost" onClick={() => setImportOpen((o) => !o)}><Ic name="arrow-up" /> Import vault</button>
        </div>
        {importOpen && (
          <div style={{ marginTop: 'var(--s3)' }}>
            <textarea
              className="ta2"
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
              placeholder="Paste an exported noema-vault-*.json here"
              style={{ width: '100%', minHeight: 120 }}
            />
            <button className="btn" onClick={doImport} disabled={!importText.trim()} style={{ marginTop: 'var(--s2)' }}>
              <Ic name="check" /> Restore
            </button>
          </div>
        )}

        {/* Recovery phrase — display-only in v1 (decision 2). */}
        <div className="sectionhead">Recovery phrase</div>
        <div className="warn">A future release will encode your vault as a phrase. For now, use the JSON export above — this is illustrative only.</div>
        <div className="phrase" style={{ filter: revealed ? 'none' : 'blur(6px)', marginTop: 'var(--s3)' }}>
          {PHRASE.map((w, i) => <span key={i}><i>{i + 1}</i>{w}</span>)}
        </div>
        {!revealed && (
          <button className="btn-ghost" style={{ marginTop: 'var(--s3)' }} onClick={() => setRevealed(true)}>
            <Ic name="eye" /> Reveal phrase
          </button>
        )}
      </div></div>
    </AppShell>
  );
}
