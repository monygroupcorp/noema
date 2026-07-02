// =============================================================================
// Mailer — a thin, vendor-neutral transactional-email seam.
// =============================================================================
//
// Email verification + password reset need to send mail, and NO email infrastructure
// exists anywhere in crystal or legacy. This is the whole dependency: a one-method
// interface, so auth is never coupled to a vendor. Two implementations:
//
//   • NoopMailer  — logs the message (and any link) instead of sending. The default
//     when unconfigured — hermetic tests + local dev read the link out of the log.
//   • HttpMailer  — posts to a provider's REST API over plain `fetch` (no new npm dep).
//     Wired for Resend (the default provider); the body-mapper is swappable.
//
// Pick the provider via env (`MAILER_PROVIDER`, `<PROVIDER>_API_KEY`, `MAIL_FROM`).
// Absent key → NoopMailer, so a deployment without mail configured degrades to
// "account exists, link is in the logs" rather than crashing.
// =============================================================================

import { makeLogger } from '../../lib/logger.js'

export interface MailMessage {
  to: string
  subject: string
  html: string
  /** Optional plain-text alternative. */
  text?: string
}

export interface Mailer {
  send(msg: MailMessage): Promise<void>
}

const log = makeLogger('api:mailer')

/** Logs instead of sending. `revealLinks:true` (dev/test default) prints the full body so a
 *  developer can copy the verify/reset link; set false in shared logs to avoid leaking links. */
export class NoopMailer implements Mailer {
  constructor(private readonly revealLinks = true) {}
  async send(msg: MailMessage): Promise<void> {
    log.info('email (noop mailer — not sent)', {
      to: msg.to,
      subject: msg.subject,
      ...(this.revealLinks ? { html: msg.html } : {}),
    })
  }
}

export interface HttpMailerConfig {
  apiKey: string
  from: string
  /** Provider REST endpoint. Defaults to Resend. */
  endpoint?: string
  /** Injected for tests; defaults to global fetch. */
  fetchFn?: typeof fetch
}

/**
 * Posts to a Resend-shaped `POST /emails` JSON API (`Authorization: Bearer <key>`,
 * body `{ from, to, subject, html }`). A non-2xx response throws so the caller can
 * decide whether to surface it (registration still succeeds; a failed send is logged
 * and the user can hit `resend-verification`).
 */
export class HttpMailer implements Mailer {
  private readonly endpoint: string
  private readonly fetchFn: typeof fetch
  constructor(private readonly cfg: HttpMailerConfig) {
    this.endpoint = cfg.endpoint ?? 'https://api.resend.com/emails'
    this.fetchFn = cfg.fetchFn ?? fetch
  }
  async send(msg: MailMessage): Promise<void> {
    const res = await this.fetchFn(this.endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${this.cfg.apiKey}` },
      body: JSON.stringify({
        from: this.cfg.from,
        to: msg.to,
        subject: msg.subject,
        html: msg.html,
        ...(msg.text ? { text: msg.text } : {}),
      }),
    })
    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      throw new Error(`mailer send failed: ${res.status} ${detail.slice(0, 200)}`)
    }
  }
}

/**
 * Build a Mailer from the environment. Returns `NoopMailer` (logs links) unless a
 * provider API key is present. Only Resend is wired today; other providers fall back
 * to Noop with a warning (add a body-mapper here to support them).
 */
export function mailerFromEnv(env: NodeJS.ProcessEnv = process.env): Mailer {
  const from = env.MAIL_FROM ?? 'NOEMA <no-reply@noema.art>'
  const provider = (env.MAILER_PROVIDER ?? 'resend').toLowerCase()
  if (provider === 'resend' && env.RESEND_API_KEY) {
    log.info('mailer: Resend configured')
    return new HttpMailer({ apiKey: env.RESEND_API_KEY, from })
  }
  if (provider !== 'resend') {
    log.warn(`mailer: provider '${provider}' not wired — falling back to NoopMailer (links logged, not sent)`)
  } else {
    log.warn('mailer: RESEND_API_KEY unset — using NoopMailer (verification/reset links are logged, not emailed)')
  }
  // In a real deployment we don't want to spray links into shared logs — reveal only
  // when explicitly allowed (local dev) via MAILER_REVEAL_LINKS=1.
  return new NoopMailer(env.MAILER_REVEAL_LINKS === '1')
}
