import type { DatabaseSync } from 'node:sqlite'
import type { AitkJob } from '../execution/aitkProgressus.js'

// =============================================================================
// AitkJobStore — read/seed ostris/ai-toolkit's SQLite `Job` row (build #5 live shell)
// =============================================================================
//
// ai-toolkit's `UITrainer` UPDATEs `Job WHERE id = AITK_JOB_ID` (and raises if the row is
// absent), so the runner must SEED the row before launching the container, then READ it to
// poll progress. Both sides share one host-mounted `aitk_db.db`. The seed mirrors the
// orchestration harness's `seed_job.py` exactly (same minimal schema + upsert), so a fresh
// OR resumed run starts clean. `read` is the `AitkJobReader` the poll loop drives.
//
// `node:sqlite` is built into Node **22.5+** — no new dependency, in-process, so the store is
// exercised hermetically against a real temp DB (no external service). It is required LAZILY
// (inside the constructor, not at module load) so this file imports cleanly on older Node (the
// staging/prod container runs Node 20 and never constructs this — registration is gated on
// `config.aitoolkit`, present only where a local trainer + Node 22 exist).
// =============================================================================

export interface AitkJobStore {
  /** Ensure the Job row exists at `status:'queued'` before the trainer runs (idempotent). */
  seed(jobId: string, opts?: { gpuIds?: string; jobConfig?: string }): Promise<void>
  /** The current Job row, or undefined if not seeded yet. Satisfies `AitkJobReader`. */
  read(jobId: string): Promise<AitkJob | undefined>
}

// The minimal table ai-toolkit's UITrainer writes — a subset of its Prisma schema, identical
// to what seed_job.py creates (CREATE IF NOT EXISTS is a no-op when the UI already made it).
const CREATE_JOB_TABLE = `
CREATE TABLE IF NOT EXISTS Job (
  id TEXT PRIMARY KEY, name TEXT UNIQUE, gpu_ids TEXT DEFAULT '0',
  job_config TEXT DEFAULT '{}', created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP, status TEXT DEFAULT 'stopped',
  stop INTEGER DEFAULT 0, return_to_queue INTEGER DEFAULT 0, step INTEGER DEFAULT 0,
  info TEXT DEFAULT '', speed_string TEXT DEFAULT '', queue_position INTEGER DEFAULT 0
)`

export class SqliteAitkJobStore implements AitkJobStore {
  private readonly db: DatabaseSync

  constructor(dbPath: string) {
    // Lazy require — see header. Throws only here (on a Node without node:sqlite), never at import.
    const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite')
    this.db = new DatabaseSync(dbPath)
    // ai-toolkit writes with autocommit while we read — wait out a momentary write lock
    // rather than failing the poll.
    this.db.exec('PRAGMA busy_timeout = 5000')
    this.db.exec(CREATE_JOB_TABLE)
  }

  async seed(jobId: string, opts?: { gpuIds?: string; jobConfig?: string }): Promise<void> {
    this.db.prepare(
      `INSERT INTO Job (id, name, gpu_ids, job_config, status, info)
       VALUES (?, ?, ?, ?, 'queued', 'seeded by crystal')
       ON CONFLICT(id) DO UPDATE SET status='queued', stop=0, info='re-run', updated_at=CURRENT_TIMESTAMP`,
    ).run(jobId, jobId, opts?.gpuIds ?? '0', opts?.jobConfig ?? '{}')
  }

  async read(jobId: string): Promise<AitkJob | undefined> {
    const row = this.db.prepare(
      'SELECT status, step, info, speed_string, queue_position FROM Job WHERE id = ?',
    ).get(jobId) as Record<string, unknown> | undefined
    if (!row) return undefined
    return {
      status: String(row.status ?? ''),
      step: Number(row.step ?? 0),
      ...(row.info != null && row.info !== '' ? { info: String(row.info) } : {}),
      ...(row.speed_string != null && row.speed_string !== '' ? { speed_string: String(row.speed_string) } : {}),
      // queue_position defaults to 0 (front of queue / not queued) — only surface a real wait.
      ...(row.queue_position != null && Number(row.queue_position) > 0 ? { queue_position: Number(row.queue_position) } : {}),
    }
  }

  close(): void {
    this.db.close()
  }
}
