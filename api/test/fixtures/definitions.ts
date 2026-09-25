import type { TemplateDefinitionInput } from '#modules/templates/definition'

/**
 * Template definitions shared by integration tests. Kept as plain DSL (not
 * built with the wizards) so a wizard change can't silently change what the
 * engine tests exercise.
 */

/** Classify (the wizard's shape): one Choice, an always-matching rule, per-label minConfidence. */
export const classifySupport: TemplateDefinitionInput = {
  kind: 'classify',
  input: {
    fields: [
      { path: 'ticket.subject', type: 'string' },
      {
        path: 'ticket.message',
        type: 'string',
        required: true,
        description: 'What the customer wrote'
      },
      {
        path: 'customer.plan',
        type: 'enum',
        enum: ['free', 'pro', 'enterprise']
      },
      { path: 'customer.email', type: 'string', pii: true }
    ]
  },
  state: { include: ['ticket.subject', 'ticket.message', 'customer.plan'] },
  decisions: [
    { label: 'bug', description: 'Something is broken', minConfidence: 0.8 },
    { label: 'billing', description: 'Money matters', minConfidence: 0.8 },
    { label: 'other', minConfidence: 0.8 }
  ],
  preconditions: [
    {
      id: 'empty_message',
      when: {
        op: 'len_lt',
        left: { input: 'ticket.message' },
        right: { value: 3 }
      },
      decision: 'other'
    }
  ],
  questions: {
    category: {
      type: 'choice',
      instructions: 'What is `ticket.message` about?',
      criteria: {
        bug: 'Something in the product is broken',
        billing: 'Charges, invoices, refunds or payment methods',
        other: null
      }
    }
  },
  rules: [
    { id: 'classify', when: { all: [] }, decision: { fromAnswer: 'category' } }
  ],
  fallback: { decision: 'needs_review' }
}

/** Decide (the wizard's shape): P(yes) ≥ 0.9 → approve, ≤ 0.1 → reject, otherwise review. */
export const decideRefund: TemplateDefinitionInput = {
  kind: 'decide',
  input: {
    fields: [
      { path: 'request', type: 'string', required: true },
      { path: 'amount', type: 'number', required: true }
    ]
  },
  decisions: [
    { label: 'approve', minConfidence: 0.8 },
    { label: 'reject', minConfidence: 0.8 }
  ],
  preconditions: [
    {
      id: 'too_expensive',
      when: { op: 'gt', left: { input: 'amount' }, right: { value: 1000 } },
      decision: 'needs_review'
    }
  ],
  questions: {
    answer: {
      type: 'boolean',
      instructions: 'Does `request` qualify for a refund under our policy?',
      criteria: { true: 'Qualifies', false: 'Does not qualify' }
    }
  },
  rules: [
    {
      id: 'yes',
      when: {
        op: 'gte',
        left: { answer: 'answer', field: 'probability' },
        right: { value: 0.5 }
      },
      decision: 'approve',
      confidenceFrom: 'answer'
    },
    {
      id: 'no',
      when: { all: [] },
      decision: 'reject',
      confidenceFrom: 'answer'
    }
  ]
}

/** Custom: several questions, a weighted signal, a flag and ordered rules. */
export const customTriage: TemplateDefinitionInput = {
  kind: 'custom',
  input: {
    fields: [
      { path: 'message', type: 'string', required: true },
      { path: 'createdAt', type: 'datetime' }
    ]
  },
  decisions: [
    { label: 'bug', minConfidence: 0.7 },
    { label: 'billing', minConfidence: 0.7 },
    { label: 'other', minConfidence: 0.7 },
    { label: 'spam' }
  ],
  questions: {
    category: {
      type: 'choice',
      instructions: 'What is `message` about?',
      criteria: { bug: null, billing: null, other: null }
    },
    severity: {
      type: 'score',
      instructions: 'How blocked is the customer?',
      levels: [
        { label: 'low', criteria: 'Cosmetic or informational' },
        { label: 'medium', criteria: 'A workaround exists' },
        { label: 'high', criteria: 'Cannot continue' }
      ]
    },
    spam: { type: 'boolean', instructions: 'Is `message` spam?' },
    frustrated: {
      type: 'boolean',
      instructions: 'Is the customer frustrated?'
    }
  },
  signals: [
    {
      name: 'spam_risk',
      kind: 'weighted',
      terms: [
        { operand: { answer: 'spam', field: 'probability' }, weight: 2 },
        {
          operand: { answer: 'category', field: 'prob', option: 'other' },
          weight: 1
        }
      ]
    }
  ],
  flagRules: [
    {
      id: 'frustration',
      when: {
        op: 'gte',
        left: { answer: 'frustrated', field: 'probability' },
        right: { value: 0.7 }
      },
      flags: ['frustrated']
    }
  ],
  rules: [
    {
      id: 'spam',
      when: { op: 'gte', left: { signal: 'spam_risk' }, right: { value: 0.8 } },
      decision: 'spam'
    },
    {
      id: 'escalate',
      when: {
        all: [
          {
            op: 'eq',
            left: { answer: 'severity', field: 'level' },
            right: { value: 'high' }
          },
          { op: 'eq', left: { flag: 'frustrated' }, right: { value: true } }
        ]
      },
      decision: 'needs_review'
    },
    {
      id: 'route',
      when: { all: [] },
      decision: { fromAnswer: 'category' }
    }
  ]
}
