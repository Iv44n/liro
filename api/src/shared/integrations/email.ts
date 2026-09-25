import { type Env, env } from '#shared/config/env'
import { log } from '#shared/config/logger'

export interface EmailMessage {
  to: string
  subject: string
  html: string
}

export interface EmailSender {
  send(message: EmailMessage): Promise<void>
}

/**
 * Keeps sent messages in memory instead of delivering them. Selected with
 * `EMAIL_PROVIDER=memory` (tests), so flows that send email — sign-up
 * verification, invitations, email effects — can be asserted on.
 */
export class MemoryEmailSender implements EmailSender {
  readonly sent: (EmailMessage & { from: string })[] = []

  async send(message: EmailMessage): Promise<void> {
    this.sent.push({ ...message, from: env.EMAIL_FROM })
  }

  clear(): void {
    this.sent.length = 0
  }
}

/** Development without a Resend key: logs each message (links included). */
class ConsoleEmailSender implements EmailSender {
  async send(message: EmailMessage): Promise<void> {
    log.logger.info(`[email] ${message.subject} → ${message.to}`, {
      html: message.html
    })
  }
}

class ResendEmailSender implements EmailSender {
  async send(message: EmailMessage): Promise<void> {
    // Imported lazily so `EMAIL_PROVIDER=memory` never needs a Resend key.
    const { resend } = await import('./resend')

    const { error } = await resend.emails.send({
      from: env.EMAIL_FROM,
      to: message.to,
      subject: message.subject,
      html: message.html
    })

    if (error) {
      log.logger.error(
        `[email] Failed to send "${message.subject}": ${error.message}`
      )
      throw new Error(error.message)
    }
  }
}

export function createEmailSender(
  provider: Env['EMAIL_PROVIDER']
): EmailSender {
  switch (provider) {
    case 'resend':
      return new ResendEmailSender()
    case 'console':
      return new ConsoleEmailSender()
    case 'memory':
      return new MemoryEmailSender()
  }
}

export const email: EmailSender = createEmailSender(env.EMAIL_PROVIDER)
