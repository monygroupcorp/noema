// =============================================================================
// copy — the brand's situational copywriting (the voice)
// =============================================================================
// One home for the words the product speaks: dry, competent, the provider is the
// fickle variable (never us). Surfaces (Telegram, web chat) read the same voice;
// only how it's delivered differs. Functions take already-formatted values
// (durations, money) so formatting stays a presentation detail in the view.

import { GLYPH } from './symbols.js'

export const HELP_TEXT = `\
noema

  Creative
  /make    — generate images and art
  /chat    — chat with an AI model
  /flows   — browse all available tools

  Account
  /status  — view balance and account
  /wallet  — manage connected wallets

  /cancel  — cancel current action
  /help    — show this message\
`

export const COPY = {
  // ── the session bulletin ───────────────────────────────────────────────────
  bulletin: {
    /** Compose the pod descriptor inside a Found line: "RTX 4090 for $0.69/hr" / "a pod". */
    podDescriptor: (gpu?: string, rate?: string): string =>
      gpu ? (rate ? `${gpu} for ${rate}` : gpu) : 'a pod',
    foundPod: (who: string, dur: string): string => `Found ${who} in ${dur}`,
    quitPod: (podNum: number, reason: string): string => `Quit pod ${podNum} for ${reason}`,
    preparedSetup: (dur: string, comparison: string): string => `Prepared Make Setup in ${dur} (${comparison})`,
    /** The "(N% > avg)" / "(N% < avg)" / "(~avg)" comparison phrasing. */
    avgComparison: (pct: number): string => pct > 0 ? `${pct}% > avg` : pct < 0 ? `${-pct}% < avg` : '~avg',

    live: {
      huntingSlow: 'Hunting for an open GPU — providers are slammed. Hang tight.',
      initializing: 'Initializing…',
      downloading: (n: number | undefined, m: number | undefined, slow: boolean): string => {
        const tail = slow ? ' — taking longer than usual' : ''
        return n && m ? `Connected, downloading models (${n}/${m})…${tail}` : `Connected, downloading models…${tail}`
      },
      plugins: 'Loading plugins…',
      reloading: 'Reloading the pod…',
      generating: 'Generating…',
      saving: 'Saving your result…',
    },

    stat: {
      gens: (n: number): string => `${n} gen${n > 1 ? 's' : ''}`,
      execAvg: (dur: string): string => `exec ~${dur} avg`,
      each: (money: string): string => `${money} ea`,
      total: (money: string): string => `${money} total`,
    },
    receiptPrefix: 'Session receipt · ',

    setupPrompt: `Set how long to keep the pod warm, then ${GLYPH.confirm}.`,
    keepCooking: (label: string, marginal: string): string => `Warm ${label}${marginal} — keep cooking.`,
    nextGen: (money: string): string => ` · next gen ~${money}`,
    podShutDown: 'Pod shut down.',
    podActive: 'Pod active.',
  },

  // ── the delivery menu's Info stats block ─────────────────────────────────────
  stats: {
    unavailable: 'Stats unavailable.',
    modus: (id: string): string => `Modus: ${id}`,
    generation: (seconds: string): string => `Generation: ${seconds}s`,
    pod: (cold: boolean): string => `Pod: ${cold ? 'cold start' : 'warm'}`,
    gpu: (g: string): string => `GPU: ${g}`,
    cost: (usd: string): string => `Cost: ~$${usd}`,
    models: (reused: number, downloaded: number): string => `Models: ${reused} reused, ${downloaded} downloaded`,
    seed: (seed: string | number): string => `Seed: ${seed}`,
  },

  // ── command surface ──────────────────────────────────────────────────────────
  command: {
    help: HELP_TEXT,
    cancelled: 'Cancelled.',
    statusComingSoon: 'Balance and account info coming soon.',
    walletComingSoon: 'Wallet management coming soon.',
    unknown: `Unknown command. Type /help to see what's available.`,
  },

  // ── transient status (acks, invites) ─────────────────────────────────────────
  status: {
    working: '⏳ Working on it…',
    done: '✅ Done.',
    podInvite: [
      'A StationThis pod is warming up.',
      'Send /make [your prompt] to queue your generation on this pod.',
      '',
      'Powered by noema.',
    ].join('\n'),
  },
} as const
