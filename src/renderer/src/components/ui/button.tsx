import type { ButtonHTMLAttributes } from 'react'
import { cn } from '@renderer/lib/utils'

type Variant = 'primary' | 'secondary' | 'ghost' | 'destructive'

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-primary text-primary-foreground hover:bg-primary/90',
  secondary: 'border border-input bg-surface text-foreground hover:bg-hover',
  ghost: 'text-foreground hover:bg-hover',
  destructive: 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
}

export function Button({
  variant = 'secondary',
  className,
  type = 'button',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }): React.JSX.Element {
  return (
    <button
      type={type}
      className={cn(
        'inline-flex h-8 items-center justify-center gap-2 rounded-sm px-3 text-sm font-medium transition-colors',
        'disabled:pointer-events-none disabled:opacity-50',
        VARIANTS[variant],
        className,
      )}
      {...props}
    />
  )
}
