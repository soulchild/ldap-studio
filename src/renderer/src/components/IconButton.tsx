import type { ButtonHTMLAttributes } from 'react'
import { cn } from '@renderer/lib/utils'

/** A small square button for pane actions. `label` is required: it is the accessible name and tooltip. */
export function IconButton({
  label,
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }): React.JSX.Element {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cn(
        'inline-flex size-7 items-center justify-center rounded-sm text-muted-foreground transition-colors',
        'hover:bg-hover hover:text-foreground disabled:pointer-events-none disabled:opacity-40',
        className,
      )}
      {...props}
    >
      {children}
    </button>
  )
}
