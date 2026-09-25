import { useState } from 'react'
import { CodeBlock } from '#/features/playground/components/json-view'
import type { JsonObject } from '#/features/templates/types/definition'
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger
} from '#/shared/components/ui/tabs'
import {
  SNIPPET_LABELS,
  SNIPPET_LANGUAGES,
  type SnippetLanguage,
  snippetFor
} from '../utils/snippets'

const STORAGE_KEY = 'liro.integrate.language'

const isLanguage = (value: unknown): value is SnippetLanguage =>
  SNIPPET_LANGUAGES.includes(value as SnippetLanguage)

/** The viewer's last chosen language (a per-browser convenience). */
function readLanguage(): SnippetLanguage {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    return isLanguage(stored) ? stored : 'curl'
  } catch {
    return 'curl'
  }
}

function saveLanguage(language: SnippetLanguage) {
  try {
    localStorage.setItem(STORAGE_KEY, language)
  } catch {
    // Storage unavailable: the choice just isn't remembered.
  }
}

/** curl / JavaScript / Python snippets calling `POST /v1/decisions/:ref/run`. */
export function CodeSnippets({
  baseUrl,
  decisionRef,
  input
}: {
  baseUrl: string
  decisionRef: string
  input: JsonObject
}) {
  const [language, setLanguage] = useState<SnippetLanguage>(readLanguage)

  return (
    <Tabs
      value={language}
      onValueChange={value => {
        if (!isLanguage(value)) return
        setLanguage(value)
        saveLanguage(value)
      }}
      className="min-w-0 gap-3"
    >
      <TabsList aria-label="Lenguaje del ejemplo">
        {SNIPPET_LANGUAGES.map(option => (
          <TabsTrigger key={option} value={option} className="px-3">
            {SNIPPET_LABELS[option]}
          </TabsTrigger>
        ))}
      </TabsList>
      {SNIPPET_LANGUAGES.map(option => (
        <TabsContent key={option} value={option} className="min-w-0">
          <CodeBlock
            code={snippetFor(option, { baseUrl, ref: decisionRef, input })}
            label={`Ejemplo en ${SNIPPET_LABELS[option]}`}
            maxHeight="max-h-[26rem]"
          />
        </TabsContent>
      ))}
    </Tabs>
  )
}
