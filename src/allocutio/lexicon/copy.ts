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
      /** Step-counted run (e.g. LoRA training): "Training · step 420/600 (70%) · ~6m left".
       *  `eta` arrives pre-formatted from the view's duration formatter. */
      training: (step: number | undefined, total: number | undefined, eta: string | undefined): string => {
        if (step === undefined) return 'Training…'
        const prog = total && total > 0
          ? `step ${step}/${total} (${Math.round((step / total) * 100)}%)`
          : `step ${step}`
        const left = eta ? ` · ~${eta} left` : ''
        return `Training · ${prog}${left}`
      },
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
    /** Armed via /arm but no pod provisioned yet — Mod • → add models, then ▸ Start. */
    armedIdle: `Studio armed — add models, then ${GLYPH.start} Start to launch.`,
    /** ▸ Start pressed — provisioning in flight (cold start: provision + bootstrap can take minutes). */
    provisioning: 'Provisioning your studio… (a cold start can take a few minutes).',
    nextGen: (money: string): string => ` · next gen ~${money}`,
    podShutDown: 'Pod shut down.',
    podActive: 'Pod active.',

    // /arm wizard headers (body text; option buttons live in affordances.ts).
    arm: {
      pickPreset: 'Arm a studio — choose a flow',
      /** Feedback on the chooser as flows are layered (stay-and-add, like the model list). */
      added: (flows: string[]): string => `Added: ${flows.join(', ')} — add more, or Proceed ›`,
      /** Rejection when a flow's runtime differs from the armed studio. One studio runs one runtime
       *  today; running both at once (co-hosting) is a future multi-runtime studio. */
      runtimeConflict: (have: string, need: string): string =>
        `⚠ This studio runs ${have}. Running ${need} alongside it needs a co-hosting studio (coming) — for now, arm a separate one.`,
      pickImage:  'Custom — pick an image',
      pickConfig: (image: string): string => `Image: ${image}\nPick a runtime`,
      /** Flow detail card (preset name tapped) — what the flow bundles before committing. */
      flow: {
        models: 'Models',
        config: (config: string): string => `Runtime: ${config}`,
        image:  (image: string): string => `Image: ${image}`,
        vram:   (gb: number): string => `Weights: ~${gb} GB`,
      },
    },
    /** An armed studio dismissed before it ever provisioned — not a pod shut-down. */
    armCancelled: 'Setup cancelled.',

    // Mod • → Add model picker (body text; button labels live in affordances.ts).
    mod: {
      /** Loadout view (shown on Mod • open): the studio's model base. */
      loadoutImage:   (image: string): string => `Image: ${image}`,
      loadoutRuntime: (runtime: string): string => `Runtime: ${runtime}`,
      loadoutEmpty:   (): string => 'No models installed on this studio yet.',
      /** Subsection title under a base model, listing the LoRAs trained for it. */
      loraSection:    'LoRA',
      /** The "Standby: …" tail — models picked but not yet installed (no pod provisioned yet, so
       *  "queued" would overstate it). Merged into the loadout when the studio is launched. */
      queued: (names: string[]): string => `Standby: ${names.join(', ')}`,
      /** The "Installing: …" tail — models downloading LIVE onto a warm pod (no gen). */
      installing: (names: string[]): string => `Installing: ${names.join(', ')}…`,
      /** Category stage header — choose a model type (mount location). */
      pickType: 'Add a model — pick a type',
      /** List stage header — the mount being browsed (or the search term) + page position. */
      listTitle: (mount: string | undefined, page: number, pageCount: number, query?: string): string => {
        const what = query ? `Search “${query}”` : (mount ?? 'models')
        const pages = pageCount > 1 ? ` · page ${page + 1}/${pageCount}` : ''
        return `${what}${pages}`
      },
      pickerEmpty: (query?: string): string => query ? `No models match “${query}”.` : 'No models available.',
      /** Model detail card (Mod • → tap a model name). Lines omitted when their field is absent. */
      detail: {
        type:    (mount: string): string => `Type: ${mount}`,
        base:    (base: string): string => `Base: ${base}`,
        trigger: (t: string): string => `Trigger: ${t}`,
        size:    (gb: number): string => `Size: ${gb} GB`,
        from:    (provenance: string): string => `From: ${provenance}`,
        by:      (auctor: string): string => `By: ${auctor}`,
      },
      /** Force-reply prompt the host replies to with a search term. */
      searchPrompt: 'Reply with a model name to search.',
      /** Force-reply prompt for adding LoRAs by trigger word(s). */
      triggerPrompt: 'Reply with trigger word(s), space- or comma-separated.',
      /** The one-line result of an add-by-trigger reply, shown under the list. */
      triggerResult: (added: string[], unmatched: string[]): string => {
        const a = added.length ? `Added: ${added.join(', ')}` : 'No triggers matched'
        const u = unmatched.length ? ` · no match: ${unmatched.join(', ')}` : ''
        return a + u
      },
    },
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
    /** Bare or malformed /run — show how to call the universal runner. */
    runUsage: `Usage: /run <flow> [prompt]\nExample: /run flux-schnell a red fox`,
    /** /run with a well-formed but unknown slug — list what's actually runnable. */
    runUnknown: (slug: string, available: string[]): string =>
      `Unknown flow '${slug}'.${available.length ? ` Try: ${available.join(', ')}` : ''}`,
    /** Bare or malformed /bind — show how to rebind a verb. */
    bindUsage: `Usage: /bind <verb> <flow>\nExample: /bind make sd1-5`,
    /** /bind with an unrecognized verb — list the verbs that can be rebound. */
    bindUnknownVerb: (verb: string, verbs: string[]): string =>
      `Unknown verb '${verb}'.${verbs.length ? ` Try: ${verbs.join(', ')}` : ''}`,
    /** /bind to a well-formed but unknown flow — list what's actually runnable. */
    bindUnknownFlow: (slug: string, available: string[]): string =>
      `Unknown flow '${slug}'.${available.length ? ` Try: ${available.join(', ')}` : ''}`,
    /** /bind succeeded — confirm the verb now points at the flow. */
    bindOk: (verb: string, slug: string): string => `/${verb} now runs ${slug}.`,
  },

  // ── save-as (flow card / delivery info → a derived, user-owned Modus) ──────────
  saveAs: {
    /** Force-reply prompt asking the user to name their saved flow. */
    namePrompt: 'Name your flow (lowercase letters, numbers, dashes). Reply to this message.',
    /** Shown when the chosen name yields an invalid slug. */
    badName: 'That name has characters I can\'t use. Try lowercase letters, numbers, and dashes.',
    /** Review header — followed by the model + porta listing and the prompt-mode toggle. */
    reviewHeader: (slug: string): string => `Save as /${slug}?`,
    /** Section label for the weight manifest in the review. */
    modelsLabel: 'Models',
    /** Section label for the captured config in the review. */
    configLabel: 'Settings',
    /** Prompt-mode toggle labels. */
    promptOpen: 'Prompt: open (ask each run)',
    promptPinned: 'Prompt: pinned (baked in)',
    /** Affix section in the review — flow-baked prompt prefix/suffix. */
    affixLabel: 'Prompt wrap',
    affixPrefixLine: (v?: string): string => `• Prefix: ${v && v.trim() ? v : '—'}`,
    affixSuffixLine: (v?: string): string => `• Suffix: ${v && v.trim() ? v : '—'}`,
    /** Force-reply prompts for setting the prefix/suffix. */
    prefixPrompt: 'Reply with the prompt PREFIX to weave before each run\'s prompt (or "-" to clear).',
    suffixPrompt: 'Reply with the prompt SUFFIX to weave after each run\'s prompt (or "-" to clear).',
    /** Affix-setter button labels. */
    setPrefixButton: 'Set prefix',
    setSuffixButton: 'Set suffix',
    /** Global-uniqueness collision — no two flows share a slug. No register happens; the draft
     *  stays alive and this rides a fresh force-reply so the host renames in place. */
    nameTaken: (slug: string): string =>
      `The name /${slug} is taken. Reply with a different name (lowercase letters, numbers, dashes).`,
    /** Register succeeded — confirm the new runnable slug. */
    saved: (slug: string): string => `Saved. Run it any time with /run ${slug}.`,
    /** Button labels. */
    saveButton: 'Save as…',
    confirmButton: 'Save',
    cancelButton: '✕',
  },

  // ── transient status (acks, invites) ─────────────────────────────────────────
  status: {
    working: '⏳ Working on it…',
    done: '✅ Done.',
    /** A private run finished, but its media could not be resolved for delivery here. Says so
     *  plainly and prints NOTHING of the reference — the marker is the one thing that must never
     *  reach the chat. The result is still on the account, readable on the web. */
    privateUndeliverable: '🔒 Your private result is ready, but it could not be sent here. Open it on the web.',
    podInvite: [
      'A NOEMA pod is warming up.',
      'Send /make [your prompt] to queue your generation on this pod.',
      '',
      'Powered by noema.',
    ].join('\n'),
  },
} as const
