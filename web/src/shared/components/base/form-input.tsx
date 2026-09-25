import { Eye, EyeOff } from 'lucide-react'
import { useState } from 'react'
import { Button } from '#/shared/components/ui/button'
import { Field, FieldError, FieldLabel } from '#/shared/components/ui/field'
import { Input } from '#/shared/components/ui/input'
import { cn } from '#/shared/utils/shadcn.utils'

type FormInputProps<T> = {
  value?: T
  name: string
  type?: 'text' | 'email' | 'password' | 'number'
  label: string
  placeholder?: string
  required?: boolean
  className?: string
  errorMessage?: string
  onValueChange: (value: T) => void
  onBlur?: () => void
  showPasswordToggle?: boolean
}

export function FormInput<T>({
  value,
  name,
  type = 'text',
  label,
  placeholder,
  required = false,
  onValueChange,
  onBlur,
  className,
  errorMessage,
  showPasswordToggle = true
}: FormInputProps<T>) {
  const [showPassword, setShowPassword] = useState(false)
  const hasError = Boolean(errorMessage)
  const isPassword = type === 'password'
  const inputType = isPassword && showPassword ? 'text' : type

  return (
    <Field data-invalid={hasError} className="space-y-2">
      <FieldLabel
        htmlFor={name}
        className={cn(
          'text-sm font-medium transition-colors',
          hasError && 'text-destructive'
        )}
      >
        {label}
      </FieldLabel>

      <div className="relative">
        <Input
          id={name}
          name={name}
          type={inputType}
          placeholder={placeholder}
          value={(value ?? '') as string | number}
          onChange={e => {
            const nextValue =
              type === 'number'
                ? e.target.value === ''
                  ? ''
                  : Number(e.target.value)
                : e.target.value

            onValueChange(nextValue as T)
          }}
          onBlur={onBlur}
          required={required}
          aria-invalid={hasError}
          aria-describedby={hasError ? `${name}-error` : undefined}
          className={cn(
            'transition-all rounded-md focus-visible:ring-2 focus-visible:ring-offset-0',
            isPassword && showPasswordToggle && 'pr-10',
            hasError && 'border-destructive focus-visible:ring-destructive/30',
            className
          )}
        />

        {isPassword && showPasswordToggle && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="absolute right-0 top-0 h-full w-10"
            onClick={() => setShowPassword(prev => !prev)}
            tabIndex={-1}
          >
            {showPassword ? (
              <EyeOff className="text-muted-foreground" />
            ) : (
              <Eye className="text-muted-foreground" />
            )}
          </Button>
        )}
      </div>

      {hasError && (
        <FieldError
          id={`${name}-error`}
          errors={[{ message: errorMessage }]}
          className="text-sm"
        />
      )}
    </Field>
  )
}
