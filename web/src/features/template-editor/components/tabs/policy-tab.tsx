import { CodeIcon, SlidersHorizontalIcon } from 'lucide-react'
import { useState } from 'react'
import { PolicyEditor } from '#/features/policy-editor/components/policy-editor'
import { Textarea } from '#/shared/components/ui/textarea'
import {
  ToggleGroup,
  ToggleGroupItem
} from '#/shared/components/ui/toggle-group'
import {
  policySectionsSchema,
  type StructureIssue,
  structureIssues
} from '../../schemas/definition'
import { useEditorContext, useEditorStore } from '../../store/editor-context'
import { policySections, setPolicySections } from '../../utils/definition-ops'

function PolicyJsonEditor() {
  const definition = useEditorStore(state => state.definition)
  const update = useEditorStore(state => state.update)
  const setInvalid = useEditorStore(state => state.setInvalid)
  const [text, setText] = useState(() =>
    definition ? JSON.stringify(policySections(definition), null, 2) : ''
  )
  const [issues, setIssues] = useState<StructureIssue[]>([])

  if (!definition) return null

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        Edita precondiciones, señales, reglas de marcas, reglas y la decisión
        por defecto como un solo objeto JSON. Se valida la forma aquí; las
        referencias (a preguntas, campos, etiquetas…) se comprueban al guardar.
      </p>
      <Textarea
        value={text}
        onChange={event => {
          const nextText = event.target.value
          setText(nextText)
          try {
            const parsed: unknown = nextText.trim()
              ? JSON.parse(nextText)
              : null
            const result = policySectionsSchema.safeParse(parsed)
            if (result.success) {
              setIssues([])
              setInvalid('policy', null)
              update(d => setPolicySections(d, result.data))
            } else {
              const parsedIssues = structureIssues(result.error)
              setIssues(parsedIssues)
              setInvalid('policy', `la política (${parsedIssues.length})`)
            }
          } catch {
            setIssues([{ path: '', message: 'JSON no válido' }])
            setInvalid('policy', 'la política (JSON no válido)')
          }
        }}
        rows={20}
        className="font-mono text-xs"
        aria-invalid={issues.length > 0}
      />
      {issues.length > 0 ? (
        <ul className="space-y-1 rounded-lg bg-destructive/10 p-2 text-xs text-destructive">
          {issues.slice(0, 20).map(issue => (
            <li key={`${issue.path}-${issue.message}`}>
              {issue.path ? <code>{issue.path}</code> : 'raíz'}: {issue.message}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

export function PolicyTab() {
  const [mode, setMode] = useState<'visual' | 'json'>('visual')
  const { templateId } = useEditorContext()
  const definition = useEditorStore(state => state.definition)
  const update = useEditorStore(state => state.update)

  return (
    <div className="space-y-4">
      <ToggleGroup
        variant="outline"
        size="sm"
        spacing={0}
        value={[mode]}
        onValueChange={values => {
          const [next] = values
          if (next === 'visual' || next === 'json') setMode(next)
        }}
        aria-label="Vista de la política"
      >
        <ToggleGroupItem value="visual">
          <SlidersHorizontalIcon aria-hidden="true" />
          Visual
        </ToggleGroupItem>
        <ToggleGroupItem value="json">
          <CodeIcon aria-hidden="true" />
          Editar JSON (avanzado)
        </ToggleGroupItem>
      </ToggleGroup>

      {mode === 'visual' ? (
        definition ? (
          <PolicyEditor
            templateId={templateId}
            definition={definition}
            update={update}
          />
        ) : null
      ) : (
        <PolicyJsonEditor />
      )}
    </div>
  )
}
