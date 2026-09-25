import { and, eq, inArray } from 'drizzle-orm'
import { members, users } from '#modules/auth/auth.schemas'
import type { EffectPayload } from '#modules/effects/payload'
import { env } from '#shared/config/env'
import { db } from '#shared/db/config'
import { email } from '#shared/integrations/email'
import { decisionEmail } from '#shared/integrations/email-templates'
import type { Deliver } from './types'

/**
 * Delivers one execution by email, re-checking `config.to` against the
 * organization's *current* verified member emails at send time (not at
 * binding-save time — a member may since have left, or never verified):
 * an address that no longer qualifies is dropped for this delivery
 * (permanently, for that address — it isn't retried once more addresses
 * pass); the rest still get the email. The whole execution only fails when
 * none do.
 */

const EVENT_LABELS: Record<EffectPayload['type'], string> = {
  'decision.made': 'A decision was made',
  'decision.review_requested': 'A decision needs review',
  'decision.reviewed': 'A review was resolved'
}

function summaryHtml(payload: EffectPayload): {
  subject: string
  html: string
} {
  const { run, review } = payload.data
  const label = EVENT_LABELS[payload.type]
  const link = `${env.APP_URL}/runs/${run.id}`
  const decision = review?.resolvedDecision ?? run.decision ?? '—'
  const confidence =
    run.confidence === null ? '—' : `${Math.round(run.confidence * 100)}%`

  const html = decisionEmail({
    eventLabel: label,
    template: run.template,
    decision,
    confidence,
    runUrl: link
  })

  return { subject: `Liro: ${label} — ${run.template}`, html }
}

/** The addresses of `candidates` that are verified emails of a current member of `organizationId`. */
async function currentVerifiedMemberEmails(
  organizationId: string,
  candidates: string[]
): Promise<Set<string>> {
  if (candidates.length === 0) return new Set()
  const rows = await db
    .select({ email: users.email })
    .from(members)
    .innerJoin(users, eq(users.id, members.userId))
    .where(
      and(
        eq(members.organizationId, organizationId),
        eq(users.emailVerified, true),
        inArray(users.email, candidates)
      )
    )
  return new Set(rows.map(row => row.email))
}

export const deliverEmail: Deliver = async execution => {
  if (!execution.bindingId) {
    return {
      ok: false,
      error: 'The effect binding no longer exists',
      permanent: true
    }
  }
  const binding = await db.query.effectBindings.findFirst({
    where: {
      id: execution.bindingId,
      organizationId: execution.organizationId,
      type: 'email'
    }
  })
  if (!binding) {
    return {
      ok: false,
      error: 'The effect binding no longer exists',
      permanent: true
    }
  }

  const addresses = (binding.config as { to: string[] }).to
  const verified = await currentVerifiedMemberEmails(
    execution.organizationId,
    addresses
  )
  const recipients = addresses.filter(address => verified.has(address))
  const dropped = addresses.filter(address => !verified.has(address))

  if (recipients.length === 0) {
    return {
      ok: false,
      permanent: true,
      error: `No recipient is a verified email of a current member of the organization: ${addresses.join(', ')}`
    }
  }

  const { subject, html } = summaryHtml(execution.payload)
  try {
    await Promise.all(recipients.map(to => email.send({ to, subject, html })))
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    }
  }

  return {
    ok: true,
    status: 200,
    body:
      dropped.length > 0
        ? `Delivered to ${recipients.length}/${addresses.length} recipient(s); dropped (not a current verified member): ${dropped.join(', ')}`
        : `Delivered to ${recipients.length} recipient(s)`
  }
}
