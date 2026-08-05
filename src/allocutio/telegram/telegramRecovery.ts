// =============================================================================
// telegramRecovery — bind a Telegram identity as an account backup + issue recovery codes.
// =============================================================================
//
// The web-auth account (username+password) and the Telegram bot are meant to be ONE
// identity (the onboarding promise). When a logged-in user links Telegram, we re-point
// their Telegram persona at the web account's soul (linkAnima + switchAnima) — reusing the
// existing Persona multi-anima structure rather than inventing a separate binding table.
// After linking, the Telegram identity resolves to the web soul, so recovery is just:
// prove the Telegram identity → mint a session for the soul it resolves to.
//
// (Consistent with anon-no-migrate: any credit on the pre-link Telegram-native anima stays
//  there; linking declares "these are the same me" going forward, it doesn't sweep balances.)
// =============================================================================

import type { PersonaStore } from '../../types/persona.js'
import type { AnimaStore } from '../../types/anima.js'
import type { LinkTokenStore } from '../../types/linkToken.js'
import { resolveOrCreateAnima } from '../api/apiAcceptors.js'

/** Recovery-code lifetime (seconds). Long enough to switch apps + paste. */
export const TELEGRAM_RECOVERY_TTL_SECONDS = 10 * 60

export interface TelegramRecoveryDeps {
  personae: Pick<PersonaStore, 'findByExternus' | 'findOrCreate' | 'linkAnima' | 'switchAnima'>
  animae: Pick<AnimaStore, 'create'>
  linkTokens: LinkTokenStore
}

/**
 * BOT side (`/start link_<code>`): redeem a web-issued link code and re-point this Telegram
 * identity's persona at the web account's soul. A Telegram can back exactly one account, so
 * linking it while bound elsewhere MOVES the binding (last-link-wins) — the same move policy
 * as `/wallet/link`. Unlike wallet, "already had a persona" does NOT imply "linked to another
 * account" (a persona also exists from anonymous bot use), so we don't emit a move-signal here
 * — it would false-positive on the common anon-bot-then-link case. Returns `'invalid'` for an
 * unknown/expired code, else `'linked'`.
 */
export async function linkTelegramToAccount(
  deps: Pick<TelegramRecoveryDeps, 'personae' | 'linkTokens'>,
  telegramUserId: string,
  code: string,
): Promise<'linked' | 'invalid'> {
  const animaId = await deps.linkTokens.consume(code, 'tg-link')
  if (!animaId) return 'invalid'
  const persona = await deps.personae.findByExternus('telegram', telegramUserId)
  if (persona) {
    if (persona.activeAnimaId !== animaId) {
      await deps.personae.linkAnima(persona.id, animaId)   // $addToSet — safe if already present
      await deps.personae.switchAnima(persona.id, animaId) // make the web soul active
    }
  } else {
    // Telegram never seen before — create its persona pointing straight at the web soul.
    await deps.personae.findOrCreate('telegram', telegramUserId, { animaId })
  }
  return 'linked'
}

/**
 * BOT side (`/recover`): mint a one-time recovery code for whatever soul this Telegram
 * identity resolves to (post-link = the web account). The user pastes it on the web sign-in
 * screen to log back in. Doubles as "sign in with Telegram" for an unlinked identity.
 */
export async function issueTelegramRecoveryCode(
  deps: TelegramRecoveryDeps,
  telegramUserId: string,
): Promise<string> {
  const animaId = await resolveOrCreateAnima(deps.personae, deps.animae, 'telegram', telegramUserId)
  return deps.linkTokens.issue(animaId, 'tg-recover', TELEGRAM_RECOVERY_TTL_SECONDS)
}
