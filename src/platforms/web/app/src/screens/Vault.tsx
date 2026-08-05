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
  setNoteLeafIndex,
  removeNote,
  addPurse,
  setPurseCredits,
  exportVault,
  importVault,
  type VaultNote,
  type VaultPurse,
} from '../lib/vault';

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
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState('');
  const [handedToken, setHandedToken] = useState('');
  const [handedBusy, setHandedBusy] = useState(false);

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

  // Recover leafIndex for any note persisted before its /issue response landed (leafIndex
  // -1). If the debit settled server-side, the leaf is in the tree keyed by commitment; a
  // 404 means issuance never committed (the note stays pending, harmless). This is what
  // turns a dropped-response note back into a spendable one instead of lost value.
  const pendingCommitments = notes.filter((n) => n.leafIndex < 0 && !n.spent).map((n) => n.commitment).join(',');
  useEffect(() => {
    if (!pendingCommitments) return;
    let live = true;
    (async () => {
      let changed = false;
      for (const n of readVault().notes) {
        if (n.leafIndex >= 0 || n.spent) continue;
        try {
          const { leaf } = await api.arcanum.getLeaf(n.commitment);
          if (!live) return;
          if (leaf && typeof leaf.leafIndex === 'number' && leaf.leafIndex >= 0) {
            setNoteLeafIndex(n.nullifier, leaf.leafIndex);
            changed = true;
          }
        } catch { /* 404 = not in tree yet; leave pending */ }
      }
      if (live && changed) reload();
    })();
    return () => { live = false; };
  }, [pendingCommitments, reload]);

  const unspent = useMemo(() => notes.filter((n) => !n.spent), [notes]);
  // ANON_PURSE_ENABLED (noema-131): the anonymous ZK purse is gated off for v1 (the arcanum
  // proving key is a forgeable dev key until the trusted-setup ceremony runs). `purseOff` = the
  // backend reported the gate closed → hide the fund/mint/paste surfaces and show coming-soon.
  // The backend refuses issue/mint/ownerless-spend regardless; this is the honest UI mirror.
  // The backend GET /arcanum/config also returns `enabled` (ANON_PURSE_ENABLED, noema-131);
  // read it defensively — the shared ArcanumConfig client type isn't widened here.
  const purseEnabled = (config as { enabled?: boolean } | null)?.enabled === true;
  const purseOff = !!config && !purseEnabled;
  const canMint = !!config?.ready && purseEnabled;
  const totalPurseCredits = useMemo(
    () => purses.reduce((sum, p) => { try { return sum + BigInt(p.credits); } catch { return sum; } }, 0n),
    [purses],
  );

  // ── Fund a note: signed-in path (POST /arcanum/issue). Client generates the secret; the
  // server settles the debit and inserts the Merkle leaf BEFORE it responds (ArcanumIssuer:
  // settle → tree.insert → return). So the secret MUST be persisted BEFORE issuing: if the
  // response is lost (timeout, blip, 5xx-after-settle) the credits are already gone and the
  // leaf already exists — the only copy of the secret needed to ever spend it must be on
  // disk, or the value is permanently unrecoverable. We store leafIndex -1 ("issued but
  // unconfirmed") first, then land the real index on success; a dropped response leaves the
  // note held, and the recovery effect below backfills its leafIndex from the commitment. ──
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
      // Persist BEFORE the network call — this is the whole fix. leafIndex -1 = unconfirmed.
      addNote({
        nullifier: note.nullifier,
        secret: note.secret,
        commitment,
        nullifierHash,
        valor: valor.toString(),
        leafIndex: -1,
        spent: false,
        createdAt: Date.now(),
      });
      reload();
      try {
        const resp = await api.arcanum.issue({ valor: valor.toString(), commitment, nullifier: note.nullifier });
        setNoteLeafIndex(note.nullifier, resp.note.leafIndex);
        reload();
        setNotice('Note funded. Export your vault before minting — these secrets exist only in this browser.');
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        // A clean 4xx reject (400 bad input, 401 auth, 402 insufficient) is thrown BEFORE
        // the server settles anything, so no debit happened — discard the placeholder note.
        // Anything else (network drop, timeout, 5xx after settle) MAY have committed the
        // debit: KEEP the note (its secret is the only recovery) and let the recovery effect
        // backfill leafIndex once the leaf confirms.
        if (/^(400|401|402)\b/.test(msg)) {
          removeNote(note.nullifier);
          reload();
          setErr(msg);
        } else {
          reload();
          setErr(`${msg} — your note secret is saved. If credits were debited it will finish confirming shortly; do not re-fund.`);
        }
      }
    } catch (e) {
      // Crypto/compute failure before anything was persisted or sent — no debit, no note.
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy({ kind: 'idle' });
    }
  }

  // ── Mint a purse: refresh the Merkle proof (root moves as the tree grows) → prove →
  // POST /arcanum/purse → store the token, THEN mark the note spent. Storing the purse
  // first means a crash after the response can't lose the token.
  //
  // A 409 is NOT safely resolvable client-side. POST /arcanum/purse burns the nullifier and
  // creates the bursa, then returns {token} exactly once and is non-idempotent: if THIS
  // mint's response was lost after that commit, the token was never captured here — the
  // credit lives under a token nobody holds. A bare 409 can't distinguish that from a note
  // legitimately minted elsewhere, so we must NOT mark it spent as if resolved and must NOT
  // claim a recoverable purse. (The real fix — return the existing bursa token on a
  // duplicate-nullifier 409 — is a server idempotency contract change for the money-code
  // spec gate, not something this screen can improvise.) ──
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
        // Do NOT mark spent and do NOT claim it's in your purses — see the docstring above.
        // Leave the note visible (unresolved) so the value isn't silently hidden.
        setErr(
          'This note was already consumed on the server, but no purse token was captured in ' +
          'this browser. If you minted it on another device, check there. Otherwise the purse ' +
          'exists under an uncaptured token — export your vault and contact support to recover ' +
          'it. Do not re-fund; the credit is not lost.',
        );
      } else {
        setErr(msg);
      }
    } finally {
      setBusy({ kind: 'idle' });
    }
  }

  // ── Use a purse you were handed: someone else's "Copy token" output pasted here. Bearer
  // credit has no owner, so this is just GET /arcanum/purse/:token (proves it's live +
  // its balance) → addPurse (idempotent on token — refreshes the cached balance if it's
  // already in the vault, no dupe) → setActivePurse (friendly default: immediately spendable).
  async function useHandedPurse() {
    const token = handedToken.trim();
    if (!token) return;
    setErr(null); setNotice(null);
    setHandedBusy(true);
    try {
      const { credits } = await api.arcanum.getPurse(token);
      const already = readVault().purses.some((p) => p.token === token);
      addPurse({ token, credits, createdAt: Date.now() });
      setActivePurse(token);
      setActive(token);
      reload();
      setHandedToken('');
      setNotice(
        already
          ? `Balance refreshed — ${credits} credits. Runs will now pay from this purse.`
          : `Purse added — ${credits} credits. Runs will now pay from this purse.`,
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setErr(/^404\b/.test(msg) ? "That's not a valid purse token." : msg);
    } finally {
      setHandedBusy(false);
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
        <div className="meta-line"><span>we receive</span><span className="v">commitment · nullifier (signed-in funding)</span></div>
        <div className="meta-line"><span>spend ↔ funder</span><span className="v">linkable only if you funded from an identified source</span></div>
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
          <div className="sub">Your local bearer-credit wallet — hold notes and purses, mint, and back up by export. Everything here lives only in this browser, and the JSON export is the only backup, so export it before you rely on it.</div>
          <div className="sub" style={{ marginTop: 'var(--s2)' }}>
            A purse spends unlinkably. Whether the <i>funding</i> stays anonymous depends on how you
            funded: fund from a shielded or fresh wallet and there's no identity to link; fund from a
            card or a doxxable wallet and the debit is linkable to that funder until we ship direct-to-commitment (blind) issuance.
          </div>
        </div></div>

        {err && <div className="warn" role="alert">{err}</div>}
        {notice && <div className="csec" style={{ borderColor: 'var(--accent)' }}>{notice}</div>}
        {configErr && <div className="warn">Couldn’t reach the anonymous-credit service — {configErr}</div>}

        {/* ANON_PURSE gate (noema-131): the anonymous purse is off for v1 (ships after the
            trusted-setup ceremony). Funding, card, wallet, and shielded-wallet anonymity all
            work now — only the ZK bearer purse waits. Coming-soon takes precedence over the
            ceremony notice below (same root cause, one clear message). */}
        {purseOff && (
          <div className="warn">
            The anonymous purse is <b>coming soon</b> — it unlocks after the trusted-setup ceremony.
            Card and on-chain wallet funding work today, and spending from a shielded or fresh wallet
            is already unlinkable. <Link to="/ceremony">See the ceremony ▸</Link>
          </div>
        )}

        {/* Honesty gate: the ceremony must be finalized before any note can be minted. */}
        {config && !config.ready && !purseOff && (
          <div className="warn">
            The trusted-setup ceremony isn’t finalized, so minting anonymous purses is disabled here.{' '}
            <Link to="/ceremony">See the ceremony ▸</Link>
          </div>
        )}

        {/* ── Purses ─────────────────────────────────────────────────────────── */}
        <div className="sectionhead">Purses</div>

        {!purseOff && (
          <div className="csec">
            <div className="ctitle">Use a purse you were handed</div>
            <div className="meta-line">
              <span>Paste a purse token someone shared with you. Anyone holding the token can spend it —
                it's bearer credit, not tied to an account.</span>
            </div>
            <div style={{ display: 'flex', gap: 'var(--s2)', marginTop: 'var(--s2)' }}>
              <input
                className="inp mono"
                type="text"
                value={handedToken}
                onChange={(e) => setHandedToken(e.target.value)}
                placeholder="paste purse token"
                style={{ flex: 1 }}
              />
              <button className="btn" onClick={useHandedPurse} disabled={handedBusy || !handedToken.trim()}>
                <Ic name="wallet" /> {handedBusy ? 'Checking…' : 'Use it'}
              </button>
            </div>
          </div>
        )}

        {purses.length === 0 ? (
          purseOff
            ? null
            : <div className="csec">No purses yet. Fund a note, then mint a purse to spend anonymously.</div>
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
        {/* Funding a note and minting a purse are the arcanum money path — hidden while the
            anonymous purse is gated off (noema-131). The backend refuses /arcanum/issue anyway. */}
        {!purseOff && (
        <>
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
              // leafIndex -1 = issuance not yet confirmed (persisted before /issue landed, or
              // a dropped response still recovering). It can't be proven, so minting waits.
              const pending = n.leafIndex < 0;
              return (
                <div key={n.nullifier} className="csec">
                  <div className="meta-line">
                    <span className="mono">{short(n.commitment)}</span>
                    <span className="v mono">{n.valor} credits</span>
                  </div>
                  <div className="meta-line"><span>leaf</span><span className="v mono">{pending ? 'confirming…' : n.leafIndex}</span></div>
                  <div style={{ marginTop: 'var(--s2)' }}>
                    <button className="btn" onClick={() => mintPurse(n)} disabled={!canMint || pending || busy.kind !== 'idle'}>
                      <Ic name="coins" /> {minting ? 'Proving… (takes a few seconds)' : 'Mint purse'}
                    </button>
                    {!canMint && <span className="mono" style={{ marginLeft: 'var(--s2)', opacity: 0.7 }}>ceremony not finalized</span>}
                    {canMint && pending && <span className="mono" style={{ marginLeft: 'var(--s2)', opacity: 0.7 }}>confirming issuance — hold your export</span>}
                  </div>
                </div>
              );
            })}
          </div>
        )}
        </>
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
      </div></div>
    </AppShell>
  );
}
