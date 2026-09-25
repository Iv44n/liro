import { useNavigate } from '@tanstack/react-router'
import { ArrowLeftIcon, WorkflowIcon } from 'lucide-react'
import { type FormEvent, useEffect, useMemo, useRef, useState } from 'react'
import type { GalleryItemView } from '#/sdk/modules/gallery/types'
import {
  Alert,
  AlertDescription,
  AlertTitle
} from '#/shared/components/ui/alert'
import { Button } from '#/shared/components/ui/button'
import { BandSlider } from '../components/band-slider'
import { BasicsFields } from '../components/basics-fields'
import { ConfidenceSlider } from '../components/confidence-slider'
import { DecideLabelsFields } from '../components/decide-labels-fields'
import { FieldsEditor } from '../components/fields-editor'
import { GalleryGrid } from '../components/gallery-grid'
import { GalleryPreview } from '../components/gallery-preview'
import { InstructionsField } from '../components/instructions-field'
import { LabelsListEditor } from '../components/labels-list-editor'
import { LevelsListEditor } from '../components/levels-list-editor'
import { MethodPicker } from '../components/method-picker'
import { PageHeader } from '../components/page-header'
import { useCreateTemplate } from '../hooks/use-create-template'
import { useTemplates } from '../hooks/use-templates'
import { validateTemplateForm } from '../schemas/template-form'
import { createErrorToFormErrors } from '../utils/server-errors'
import { suggestSlug, uniqueSlug } from '../utils/slug'
import {
  type CreationMethod,
  defaultFormValues,
  isWizardMethod,
  type TemplateFormValues,
  toCreateTemplateRequest
} from '../utils/template-form'

type Step = 'method' | 'gallery' | 'form'

const METHOD_TITLES: Record<CreationMethod, string> = {
  classify: 'Clasificar',
  score: 'Puntuar (escala)',
  decide: 'Decidir sí/no',
  gallery: 'Desde la galería',
  blank: 'En blanco (personalizado)'
}

const STEP_DESCRIPTIONS: Record<Step, string> = {
  method: 'Elige cómo quieres crear tu decisión.',
  gallery: 'Elige una plantilla lista para usar.',
  form: 'Completa los datos de tu decisión.'
}

/** `/decisions/new`: step 1 chooses how, step 2 fills the matching wizard. */
export default function NewTemplatePage() {
  const navigate = useNavigate()
  const { createTemplate, isPending } = useCreateTemplate()
  const { data: templates } = useTemplates('all')
  const takenSlugs = useMemo(
    () => new Set((templates ?? []).map(template => template.slug)),
    [templates]
  )

  const [step, setStep] = useState<Step>('method')
  const [method, setMethod] = useState<CreationMethod | null>(null)
  const [galleryItem, setGalleryItem] = useState<GalleryItemView | null>(null)
  const [values, setValues] = useState<TemplateFormValues>(() =>
    defaultFormValues('blank')
  )
  const [slugEdited, setSlugEdited] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [formErrors, setFormErrors] = useState<string[]>([])
  const formRef = useRef<HTMLFormElement>(null)

  // Move focus (and the viewport) to the first invalid field whenever a
  // submit attempt fails, so a sighted user isn't left looking at an
  // unchanged screen when the only error is in a section below the fold,
  // and a screen-reader user lands on the field the error describes.
  useEffect(() => {
    if (Object.keys(errors).length === 0) return
    const form = formRef.current
    if (!form) return
    // Prefer the first actually-invalid field (so focus lands on the input
    // itself); only fall back to an alert region (e.g. the "at least 2
    // labels" list-level message, which isn't tied to a single input) when
    // no field matched — the summary alert above is one such region, and
    // it's already at the top of the form, so that fallback is fine too.
    const target =
      form.querySelector<HTMLElement>('[aria-invalid="true"]') ??
      form.querySelector<HTMLElement>('[role="alert"]')
    target?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    target?.focus({ preventScroll: true })
  }, [errors])

  const startMethod = (nextMethod: CreationMethod) => {
    setMethod(nextMethod)
    setGalleryItem(null)
    setValues(defaultFormValues(nextMethod))
    setSlugEdited(false)
    setErrors({})
    setFormErrors([])
    setStep('form')
  }

  const startGalleryItem = (item: GalleryItemView) => {
    setMethod('gallery')
    setGalleryItem(item)
    setValues(defaultFormValues('gallery', item))
    setSlugEdited(false)
    setErrors({})
    setFormErrors([])
    setStep('form')
  }

  const goBack = () => {
    setErrors({})
    setFormErrors([])
    setStep(step === 'form' && method === 'gallery' ? 'gallery' : 'method')
  }

  const changeName = (name: string) => {
    setValues(prev => ({
      ...prev,
      name,
      slug: slugEdited ? prev.slug : uniqueSlug(suggestSlug(name), takenSlugs)
    }))
  }

  const changeSlug = (slug: string) => {
    setSlugEdited(true)
    setValues(prev => ({ ...prev, slug }))
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!method) return

    const validationErrors = validateTemplateForm(method, values)
    if (Object.keys(validationErrors).length > 0) {
      setErrors(validationErrors)
      setFormErrors([])
      return
    }

    setErrors({})
    setFormErrors([])
    try {
      const request = toCreateTemplateRequest(method, values, galleryItem?.id)
      const { template } = await createTemplate(request)
      await navigate({
        to: '/decisions/$templateId',
        params: { templateId: template.id },
        replace: true
      })
    } catch (error) {
      const result = createErrorToFormErrors(error)
      setErrors(result.fields)
      setFormErrors(result.form)
    }
  }

  const declaredFieldPaths = values.fields
    .map(field => field.path.trim())
    .filter(Boolean)

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6">
      <PageHeader
        icon={<WorkflowIcon />}
        title="Nueva decisión"
        description={
          step === 'form' && method
            ? `${METHOD_TITLES[method]} · ${STEP_DESCRIPTIONS.form}`
            : STEP_DESCRIPTIONS[step]
        }
        action={
          step !== 'method' ? (
            <Button type="button" variant="ghost" size="sm" onClick={goBack}>
              <ArrowLeftIcon aria-hidden="true" />
              Atrás
            </Button>
          ) : null
        }
      />

      {step === 'method' ? (
        <MethodPicker
          onSelect={selected =>
            selected === 'gallery' ? setStep('gallery') : startMethod(selected)
          }
        />
      ) : null}

      {step === 'gallery' ? <GalleryGrid onSelect={startGalleryItem} /> : null}

      {step === 'form' && method ? (
        <form
          ref={formRef}
          onSubmit={handleSubmit}
          className="space-y-6"
          noValidate
        >
          {formErrors.length > 0 ? (
            <Alert variant="destructive">
              <AlertTitle>No se pudo crear la decisión</AlertTitle>
              <AlertDescription>
                {formErrors.length === 1 ? (
                  formErrors[0]
                ) : (
                  <ul className="list-disc space-y-1 ps-4">
                    {formErrors.map(message => (
                      <li key={message}>{message}</li>
                    ))}
                  </ul>
                )}
              </AlertDescription>
            </Alert>
          ) : formErrors.length === 0 && Object.keys(errors).length > 0 ? (
            <Alert variant="destructive">
              <AlertTitle>Revisa los campos marcados</AlertTitle>
              <AlertDescription>
                Hay campos con errores más abajo en el formulario.
              </AlertDescription>
            </Alert>
          ) : null}

          {method === 'gallery' && galleryItem ? (
            <GalleryPreview
              item={galleryItem}
              onChangeItem={() => setStep('gallery')}
            />
          ) : null}

          <section className="space-y-4">
            <h2 className="text-sm font-medium text-muted-foreground">
              Datos básicos
            </h2>
            <BasicsFields
              values={values}
              errors={errors}
              onNameChange={changeName}
              onSlugChange={changeSlug}
              onDescriptionChange={description =>
                setValues(prev => ({ ...prev, description }))
              }
            />
          </section>

          {isWizardMethod(method) ? (
            <>
              <section className="space-y-4">
                <h2 className="text-sm font-medium text-muted-foreground">
                  Entrada
                </h2>
                <FieldsEditor
                  fields={values.fields}
                  errors={errors}
                  onChange={fields => setValues(prev => ({ ...prev, fields }))}
                />
              </section>

              <section className="space-y-4">
                <h2 className="text-sm font-medium text-muted-foreground">
                  Instrucciones para el modelo
                </h2>
                <InstructionsField
                  value={values.instructions}
                  error={errors.instructions}
                  fieldPaths={declaredFieldPaths}
                  onChange={instructions =>
                    setValues(prev => ({ ...prev, instructions }))
                  }
                  label={
                    method === 'decide'
                      ? 'Pregunta para el modelo'
                      : 'Instrucciones para el modelo'
                  }
                  placeholder={
                    method === 'decide'
                      ? '¿Debe aprobarse el reembolso?'
                      : 'Explica al modelo qué debe evaluar…'
                  }
                />
              </section>

              {method === 'classify' ? (
                <section className="space-y-4">
                  <h2 className="text-sm font-medium text-muted-foreground">
                    Etiquetas
                  </h2>
                  <LabelsListEditor
                    labels={values.labels}
                    errors={errors}
                    onChange={labels =>
                      setValues(prev => ({ ...prev, labels }))
                    }
                  />
                  <ConfidenceSlider
                    value={values.minConfidence}
                    onChange={minConfidence =>
                      setValues(prev => ({ ...prev, minConfidence }))
                    }
                  />
                </section>
              ) : null}

              {method === 'score' ? (
                <section className="space-y-4">
                  <h2 className="text-sm font-medium text-muted-foreground">
                    Niveles
                  </h2>
                  <LevelsListEditor
                    levels={values.levels}
                    errors={errors}
                    onChange={levels =>
                      setValues(prev => ({ ...prev, levels }))
                    }
                  />
                  <ConfidenceSlider
                    value={values.minConfidence}
                    onChange={minConfidence =>
                      setValues(prev => ({ ...prev, minConfidence }))
                    }
                  />
                </section>
              ) : null}

              {method === 'decide' ? (
                <section className="space-y-4">
                  <h2 className="text-sm font-medium text-muted-foreground">
                    Respuesta
                  </h2>
                  <DecideLabelsFields
                    yes={values.yes}
                    no={values.no}
                    errors={errors}
                    onYesChange={yes => setValues(prev => ({ ...prev, yes }))}
                    onNoChange={no => setValues(prev => ({ ...prev, no }))}
                  />
                  <BandSlider
                    value={values.bands}
                    onChange={bands => setValues(prev => ({ ...prev, bands }))}
                  />
                </section>
              ) : null}
            </>
          ) : null}

          <div className="flex justify-end border-t pt-4">
            <Button type="submit" disabled={isPending}>
              {isPending ? 'Creando…' : 'Crear decisión'}
            </Button>
          </div>
        </form>
      ) : null}
    </div>
  )
}
