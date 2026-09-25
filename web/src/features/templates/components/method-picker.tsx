import {
  GaugeIcon,
  LayoutTemplateIcon,
  PuzzleIcon,
  SplitIcon,
  TagsIcon
} from 'lucide-react'
import type { CreationMethod } from '../utils/template-form'

interface MethodOption {
  value: CreationMethod
  title: string
  description: string
  icon: typeof TagsIcon
}

const METHODS: MethodOption[] = [
  {
    value: 'classify',
    title: 'Clasificar',
    description:
      'El modelo elige una etiqueta entre varias opciones, p. ej. a qué cola va un ticket.',
    icon: TagsIcon
  },
  {
    value: 'score',
    title: 'Puntuar (escala)',
    description:
      'El modelo ubica la entrada en una escala ordenada de niveles, p. ej. de riesgo bajo a alto.',
    icon: GaugeIcon
  },
  {
    value: 'decide',
    title: 'Decidir sí/no',
    description:
      'El modelo responde sí o no a una pregunta; los casos dudosos van a revisión humana.',
    icon: SplitIcon
  },
  {
    value: 'gallery',
    title: 'Desde la galería',
    description:
      'Empieza de una plantilla lista para usar y ajústala a tu caso.',
    icon: LayoutTemplateIcon
  },
  {
    value: 'blank',
    title: 'En blanco (personalizado)',
    description:
      'Crea una decisión vacía y define preguntas, señales y reglas en el editor.',
    icon: PuzzleIcon
  }
]

/** Step 1 of `/decisions/new`: how the new decision starts. */
export function MethodPicker({
  onSelect
}: {
  onSelect: (method: CreationMethod) => void
}) {
  return (
    <ul
      aria-label="Métodos para crear una decisión"
      className="grid gap-4 sm:grid-cols-2"
    >
      {METHODS.map(({ value, title, description, icon: Icon }) => (
        <li key={value}>
          <button
            type="button"
            onClick={() => onSelect(value)}
            className="flex h-full w-full flex-col items-start gap-3 rounded-2xl bg-card p-5 text-start ring-1 ring-foreground/10 transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <div
              className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary [&_svg]:size-5"
              aria-hidden="true"
            >
              <Icon />
            </div>
            <div className="space-y-1">
              <h2 className="font-medium">{title}</h2>
              <p className="text-sm text-muted-foreground">{description}</p>
            </div>
          </button>
        </li>
      ))}
    </ul>
  )
}
