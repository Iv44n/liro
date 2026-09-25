import { email, MemoryEmailSender } from '#shared/integrations/email'

/** The in-memory email sender used under `EMAIL_PROVIDER=memory`. */
export function sentEmails(): MemoryEmailSender {
  if (!(email instanceof MemoryEmailSender)) {
    throw new Error('sentEmails() requires EMAIL_PROVIDER=memory')
  }
  return email
}

export function emailsTo(address: string) {
  return sentEmails().sent.filter(message => message.to === address)
}
