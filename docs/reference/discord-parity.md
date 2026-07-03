# Discord bot — rebuild reference (post-nuke)

- **Date:** 2026-07-02
- **Why this exists:** the legacy Discord bot (`main:src/platforms/discord/**`) is deprecated and
  **not release-blocking**, but we want to rebuild it in TS *when we choose*, mirroring the crystal
  Telegram adapter. This doc captures the surface to rebuild so `platforms/discord/**` can be
  **deleted in the nuke** without losing what we need. (Deep source also survives in git:
  `git show main:src/platforms/discord/<path>`.)
- **Build principle:** do NOT port the JS. Rebuild as a thin Discord `Allocutio` over the same
  `/v1` API + lexicon the crystal Telegram bot uses — Discord is another *channel*, not new backend.

## Target architecture to mirror (crystal Telegram)

The crystal Telegram adapter is the template — copy its shape for Discord:
- `src/allocutio/telegram/TelegramAllocutio.ts` — the channel adapter (wired in `src/index.ts`).
- `src/allocutio/telegram/commands/CommandRouter.ts` — command dispatch (`make`/`run`/`chat`/
  `flows`/`status`/`wallet`/`cancel`/`help`, deep-links).
- `src/allocutio/lexicon/**` — the channel-agnostic interaction vocabulary: `bulletin/*` (session
  HUD, Mod submenu, model catalog), `delivery/DeliveryMenu.ts` (rate/rerun/tweak/info/save/share),
  `status/StatusView.ts`, `SaveAsMenu.ts`. **Most of the lexicon is already channel-neutral** — a
  Discord adapter should reuse it and only implement Discord-native rendering (slash commands +
  message components/buttons/modals instead of Telegram inline keyboards).

A crystal Discord adapter = `src/allocutio/discord/DiscordAllocutio.ts` + a `CommandRouter` that
maps Discord slash-commands/interactions onto the same lexicon + `/v1` calls.

## Legacy Discord surface to reproduce (from `main:src/platforms/discord/**`)

| Discord feature | legacy handler (`main:src/platforms/discord/`) | crystal target to call | mirror from Telegram |
|---|---|---|---|
| `/cast` (spell cast) | `commands/castCommand.js` | `POST /v1/runs` (flow cast) | `CommandRouter` make/run |
| Dynamic per-tool commands | `dynamicCommands.js`, `dispatcher.js` | `/v1/flows` + `POST /v1/runs` | dynamic `/run <slug>` + `/flows` |
| `/status` | `commands/statusCommand.js` | `/v1/me/status` | `lexicon/status/StatusView.ts` |
| `/account` | `commands/accountCommand.js` | `/v1/me` | Telegram status/account |
| `/settings` gen params | `commands/settingsCommand.js` | `/v1/me/generatio` + `/bind` | bulletin Mod submenu + `/bind` |
| `/collections` (list/shared/create/view/items/share) | `commands/collectionsCommand.js` | `/v1/collectiones/*` | (collections not yet in crystal TG bot — build fresh over `/v1`) |
| `/train` LoRA (list/create/view/upload/start) | `commands/trainModelCommand.js` | training via `MODUS_AITOOLKIT_TRAINING`→`/v1/runs` + trainings-mgmt endpoints (blocker #8) | (train not yet in crystal TG bot) |
| Component menus (delivery/mods/settings/tools) | `components/{delivery,mods,settings,tools}*` | — | `lexicon/delivery/DeliveryMenu.ts`, bulletin affordances |
| Component menus (account/buyPoints/wallet/group) | `components/{account,buyPoints,wallet,group}*` | depends on buy-credits (blocker #9) + wallet paths | Telegram `/wallet` (stub) |
| `/testMessageReference` | `commands/testMessageReferenceCommand.js` | — | DROP (dev test) |

## Notes for the rebuild

- Discord-native primitives replace Telegram ones: **slash commands** (register via the Discord API)
  for commands; **message components** (buttons/select menus) + **modals** for the delivery/mods/
  settings interactions the lexicon models as affordances.
- Reuse the envelope-sourcing idiom for image inputs (attached image / reply-to) — mirror
  `feedback_telegram_image_input_envelope` for Discord attachments.
- Gaps the Discord bot shares with the Telegram bot (build once, both benefit): buy-credits helper
  (#9), trainings-management (#8), collections-from-chat.
- The legacy per-command deep logic (option schemas, embed layouts) is recoverable any time via
  `git show main:src/platforms/discord/commands/<cmd>.js` — this doc is the index, not a copy.

**Pre-nuke checklist item:** this reference exists → `platforms/discord/**` is safe to delete.
