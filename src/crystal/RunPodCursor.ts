import type { Modus, Modorum } from '../types/modus.js'
import type { Actum } from '../types/actum.js'
import type { Modo } from '../types/modo.js'
import type { Cursor, CursorResult } from '../types/cursus.js'

type RunResult =
  | { status: 'completed'; podId: string; timings: { totalMs: number }; outputs: unknown[]; error?: never }
  | { status: 'stalled'; podId: string; timings: { totalMs: number }; outputs: unknown[]; error: { code: string; message: string } }

interface Runner {
  runDeployment(args: { deployment: unknown; accountId: string; jobId: string }): Promise<RunResult>
}

interface Config {
  accountId: string
  /** Upper-bound seconds for a single pod job. Default 1800 (30 min). */
  maxJobSeconds?: number
}

export class RunPodCursor implements Cursor {
  constructor(
    private readonly runner: Runner,
    private readonly compile: (modus: Modus, aditus: Record<string, unknown>) => Promise<unknown>,
    private readonly modorum: Modorum,
    private readonly config: Config,
  ) {}

  async reserve(modus: Modus, _aditus: Record<string, unknown>): Promise<bigint> {
    if (modus.impetusFixum !== undefined) return modus.impetusFixum
    return BigInt(this.config.maxJobSeconds ?? 1800)
  }

  async run(actum: Actum, _modo?: Modo): Promise<CursorResult> {
    // aditus validated by validateAditus before dispatch
    const modus = await this.modorum.find(actum.modusId, actum.modusVersiono)
    if (!modus) throw new Error(`Modus '${actum.modusId}' not found`)

    const deployment = await this.compile(modus, actum.aditus)

    const result = await this.runner.runDeployment({
      deployment,
      accountId: this.config.accountId,
      jobId: actum.id,
    })

    if (result.status === 'stalled') {
      throw new Error(`Execution stalled: ${result.error.message}`)
    }

    const duratio = result.timings.totalMs
    const impetus = BigInt(Math.ceil(duratio / 1000))

    return {
      kind: 'sync',
      exitus: {
        exitus: { outputs: result.outputs },
        impetus,
        duratio,
        materiamId: result.podId,
      },
    }
  }
}
