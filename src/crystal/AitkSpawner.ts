import { spawn } from 'node:child_process'

// =============================================================================
// AitkSpawner — launch the ostris/ai-toolkit training container (build #5 live shell)
// =============================================================================
//
// The runner seeds the Job row host-side (SqliteAitkJobStore), then starts the container
// running ai-toolkit's `run.py` against the training config. The container drives the
// host-mounted `Job` row as it trains; the runner's poll loop reads it back. This mirrors
// the orchestration harness's `train_stationthis.sh` docker invocation, detached (`-d`):
// `start()` returns once the container is up and the poll loop takes over (it owns
// completion, off the DB). Injected into the cursor so its orchestration is testable with
// no Docker (a fake spawner records the call).
// =============================================================================

export interface AitkMount { host: string; container: string }

export interface AitkRunSpec {
  jobId: string
  image: string
  /** Training config path INSIDE the container (relative to the `-w` workdir, e.g. `config/x.yaml`). */
  configPath: string
  gpuId?: string
  /** Host:container bind mounts (the ai-toolkit clone, the dataset, the HF cache). */
  mounts?: AitkMount[]
  /** Container workdir (where `run.py` lives) — default `/aitk`. */
  workdir?: string
  /**
   * `--shm-size` for the container (e.g. '8g'). PyTorch's DataLoader workers share tensors
   * through /dev/shm; Docker's 64MB default is too small and kills them with a Bus error.
   * Default '8g' — set lower only on a memory-tight host.
   */
  shmSize?: string
  env?: Record<string, string>
}

export interface AitkSpawner {
  /** Launch the training container; resolves once it has started (rejects if launch fails). */
  start(spec: AitkRunSpec): Promise<void>
}

/**
 * Build the `docker run -d` arg vector for a training launch (mirrors train_stationthis.sh).
 * Pure — so the launch command is verifiable in CI even though the spawn itself isn't.
 */
export function buildAitkDockerArgs(spec: AitkRunSpec): string[] {
  const args = [
    'run', '-d', '--rm',
    '--name', `aitk-${spec.jobId}`,
    '--gpus', `device=${spec.gpuId ?? '0'}`,
    '--shm-size', spec.shmSize ?? '8g',   // PyTorch DataLoader needs >64MB /dev/shm
    '-e', `AITK_JOB_ID=${spec.jobId}`,
    '-e', 'AITK_DB=/aitk/aitk_db.db',
  ]
  for (const [k, v] of Object.entries(spec.env ?? {})) args.push('-e', `${k}=${v}`)
  for (const m of spec.mounts ?? []) args.push('-v', `${m.host}:${m.container}`)
  args.push('-w', spec.workdir ?? '/aitk', spec.image, 'bash', '-lc', `python -u run.py '${spec.configPath}'`)
  return args
}

/** Real Docker spawner — `docker run -d` the ai-toolkit image (mirrors train_stationthis.sh). */
export class DockerAitkSpawner implements AitkSpawner {
  constructor(private readonly bin: string = 'docker') {}

  start(spec: AitkRunSpec): Promise<void> {
    return this._run(buildAitkDockerArgs(spec))
  }

  private _run(args: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
      const proc = spawn(this.bin, args, { stdio: ['ignore', 'ignore', 'pipe'] })
      let stderr = ''
      proc.stderr.on('data', (d) => { stderr += String(d) })
      proc.on('error', reject)
      proc.on('close', (code) =>
        code === 0 ? resolve() : reject(new Error(`docker run exited ${code}: ${stderr.trim().slice(-2000)}`)),
      )
    })
  }
}
