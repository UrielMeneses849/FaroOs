import { useId, type InputHTMLAttributes } from 'react'

interface FormFieldProps extends InputHTMLAttributes<HTMLInputElement> { label: string; hint?: string; error?: string }

export function FormField({ label, hint, error, id, ...props }: FormFieldProps) {
  const generatedId = useId()
  const fieldId = id ?? generatedId
  const descriptionId = `${fieldId}-description`
  return (
    <div className="form-field">
      <label htmlFor={fieldId}>{label}</label>
      <input id={fieldId} aria-invalid={Boolean(error)} aria-describedby={hint || error ? descriptionId : undefined} {...props} />
      {(error || hint) && <span id={descriptionId} className={error ? 'field-error' : 'field-hint'}>{error ?? hint}</span>}
    </div>
  )
}
