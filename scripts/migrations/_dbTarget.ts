// =============================================================================
// Shared `--db` target resolver for scripts/migrations/*.ts.
// =============================================================================
//
// One resolver so the live/legacy distinction can never drift per-script again.
//
// The LIVE application database. Verified 2026-08-11 against the running prod
// container:
//   docker exec hyperbotcontained printenv DB_NAME  ->  noemaplane
// `noema` is the pre-cutover LEGACY db (MONGO_DB_NAME, the cutover source), NOT
// production. Do not "correct" this back without re-running that command.
export const LIVE_DB = 'noemaplane'
export const LEGACY_DB = 'noema'

export interface DbTarget {
  db: string
  dryRun: boolean
}

/** Thrown by `resolveDbTarget` for every refusal. Callers catch it, print
 * `err.message`, and exit 1 — kept as a throw (not `process.exit`) so the
 * resolver is a pure function testable with synthetic argv and no process
 * exit in the test runner. */
export class DbTargetRefusedError extends Error {}

/**
 * Read `--db <name>` from argv. Enforces, in order:
 *   - `--db` required; no default — an unset target is an error, never a guess.
 *   - `db === LEGACY_DB` -> refuse regardless of `--prod` (dead cutover source; a write
 *     here is always a mistake or a stale copy-paste of an old header).
 *   - `db === LIVE_DB` and no `--prod` -> refuse (this IS the live db; run it deliberately).
 *     This holds even for a read: `--prod` is required to READ production too
 *     (`--db LIVE_DB --prod --dry-run`), deliberately — rth's ruling 2026-08-12 keeps
 *     `--prod` as the ONE gate on the live db rather than letting `--dry-run` clear it,
 *     since the resolver cannot itself enforce that every migration honours `DRY_RUN`
 *     on every write path. Do not "fix" this by letting `--dry-run` bypass `--prod`.
 *   - any other name, no `--allow-unknown-db` -> refuse. A plausible-looking wrong name
 *     (e.g. a typo of the live db) must not be silently accepted — accepting it lets a
 *     migration report `updated=0` against an empty scratch db and be read as "nothing
 *     to do", the same false-confidence failure as the inversion this resolver replaces.
 *   - any other name, with `--allow-unknown-db` -> accepted, with a one-line notice that
 *     it is not the live db, so `updated=0` there is never mistaken for "nothing to do".
 */
export function resolveDbTarget(argv: string[], tag: string): DbTarget {
  const i = argv.indexOf('--db')
  const db = i >= 0 ? argv[i + 1] : undefined
  if (!db) {
    throw new DbTargetRefusedError(
      `${tag} refusing to run: pass --db <name> (e.g. --db ${LIVE_DB}). No default — .env points at the live cluster.`,
    )
  }
  const prod = argv.includes('--prod')
  if (db === LEGACY_DB) {
    throw new DbTargetRefusedError(
      `${tag} refusing to target "${LEGACY_DB}" — it is the pre-cutover LEGACY db, not production. Use --db ${LIVE_DB} --prod for the real production run.`,
    )
  }
  if (db === LIVE_DB && !prod) {
    throw new DbTargetRefusedError(
      `${tag} refusing to target the PRODUCTION db "${LIVE_DB}" without --prod. To READ production without ` +
        `writing, use --db ${LIVE_DB} --prod --dry-run (--prod clears this gate; --dry-run suppresses every ` +
        `write). For dev/test use --db <scratch-name> --allow-unknown-db.`,
    )
  }
  if (db !== LIVE_DB && !argv.includes('--allow-unknown-db')) {
    throw new DbTargetRefusedError(
      `${tag} refusing to target unrecognized db "${db}" without --allow-unknown-db. This guards against a plausible-looking wrong name being accepted and silently reporting updated=0. Pass --allow-unknown-db to confirm this is an intentional scratch db.`,
    )
  }
  if (db !== LIVE_DB) {
    console.log(`${tag} note: "${db}" is not the live db (${LIVE_DB}) — a result of updated=0 here means nothing to do in THIS db, not in production.`)
  }
  const dryRun = argv.includes('--dry-run')
  return { db, dryRun }
}
