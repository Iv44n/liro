import { describe, expect, mock, test } from 'bun:test'
import { env } from '#shared/config/env'
import { createEmailSender, type MemoryEmailSender } from './email'

const message = { to: 'someone@liro.test', subject: 'Hello', html: '<p>Hi</p>' }

describe('email senders', () => {
  test('memory keeps messages, stamped with EMAIL_FROM', async () => {
    const sender = createEmailSender('memory') as MemoryEmailSender

    await sender.send(message)
    expect(sender.sent).toEqual([{ ...message, from: env.EMAIL_FROM }])

    sender.clear()
    expect(sender.sent).toEqual([])
  })

  test('console only logs', async () => {
    await expect(
      createEmailSender('console').send(message)
    ).resolves.toBeUndefined()
  })

  test('resend sends from EMAIL_FROM and surfaces API errors', async () => {
    const send = mock(async () => ({ data: { id: 'email_1' }, error: null }))
    mock.module('./resend', () => ({ resend: { emails: { send } } }))
    const sender = createEmailSender('resend')

    await sender.send(message)
    expect(send).toHaveBeenCalledWith({ from: env.EMAIL_FROM, ...message })

    send.mockImplementationOnce(
      async () =>
        ({
          data: null,
          error: { message: 'domain not verified' }
        }) as never
    )
    await expect(sender.send(message)).rejects.toThrow('domain not verified')
  })
})
