import { LoaderCircle } from 'lucide-react'
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { cn } from '../../lib/utils'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
  size?: 'sm' | 'md' | 'lg'
  loading?: boolean
  icon?: ReactNode
}

export function Button({ children, className, variant = 'primary', size = 'md', loading, icon, disabled, ...props }: ButtonProps) {
  return (
    <button className={cn('button', `button--${variant}`, `button--${size}`, className)} disabled={disabled || loading} {...props}>
      {loading ? <LoaderCircle className="spin" aria-hidden="true" /> : icon}
      <span>{children}</span>
    </button>
  )
}
