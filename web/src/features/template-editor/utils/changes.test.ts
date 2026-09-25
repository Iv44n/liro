import { describe, expect, it } from 'vitest'
import type { DefinitionChange } from '#/features/templates/types/definition'
import { describeChange, groupChanges } from './changes'

const change = (
  partial: Partial<DefinitionChange> & Pick<DefinitionChange, 'code'>
): DefinitionChange => ({
  severity: 'compatible',
  message: '',
  ...partial
})

describe('describeChange()', () => {
  it('names the label/field/question the change is about', () => {
    expect(
      describeChange(
        change({
          code: 'LABEL_ADDED',
          path: 'decisions.urgent',
          message: 'Label `urgent` added'
        })
      )
    ).toBe('Etiqueta nueva `urgent`')
    expect(
      describeChange(
        change({
          code: 'FIELD_REMOVED',
          path: 'input.fields.ticket.message',
          message: 'Field `ticket.message` removed'
        })
      )
    ).toBe('Campo eliminado `ticket.message`')
    expect(
      describeChange(
        change({
          code: 'FIELD_TYPE_CHANGED',
          path: 'input.fields.level',
          message: 'Field `level` changed type from string to enum'
        })
      )
    ).toBe('El campo `level` cambió de tipo (string → enum)')
  })

  it('summarizes a policy section change from its message', () => {
    expect(
      describeChange(
        change({
          code: 'POLICY_CHANGED',
          path: 'rules',
          message: 'Rules: added `r2`; removed `r1`'
        })
      )
    ).toBe('Reglas: añadidas `r2`; eliminadas `r1`')
    expect(
      describeChange(
        change({
          code: 'POLICY_CHANGED',
          path: 'fallback',
          message: 'Fallback changed from `a` to `b`'
        })
      )
    ).toBe('Decisión por defecto: `a` → `b`')
    expect(
      describeChange(
        change({
          code: 'POLICY_CHANGED',
          path: 'decisions.billing',
          message: 'Label `billing`: minConfidence 0.8 → 0.9'
        })
      )
    ).toBe('Umbral o revisión de la etiqueta `billing`')
  })

  it('falls back to the raw message for an unknown code', () => {
    expect(
      describeChange({
        code: 'MODEL_CHANGED',
        severity: 'behavior',
        message: 'Model changed from jev (latest) to jev-1.2.3',
        path: 'model'
      })
    ).toBe('Cambió el modelo')
  })
})

describe('groupChanges()', () => {
  it('buckets changes by severity, keeping empty buckets', () => {
    const groups = groupChanges([
      change({ code: 'LABEL_ADDED', severity: 'breaking' }),
      change({ code: 'DESCRIPTION_CHANGED', severity: 'compatible' })
    ])
    expect(groups.breaking).toHaveLength(1)
    expect(groups.compatible).toHaveLength(1)
    expect(groups.behavior).toEqual([])
  })
})
