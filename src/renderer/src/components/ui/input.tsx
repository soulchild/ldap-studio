import { forwardRef, type InputHTMLAttributes } from 'react'
import { cn } from '@renderer/lib/utils'

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { mono?: boolean }>(
  function Input({ className, mono, ...props }, ref) {
    return (
      <input
        ref={ref}
        className={cn(
          'h-8 w-full min-w-0 rounded-sm border border-input bg-surface px-2.5 text-sm text-foreground',
          'placeholder:text-subtle-foreground focus-visible:border-primary focus-visible:outline-none',
          'aria-invalid:border-destructive disabled:opacity-50',
          mono && 'font-mono',
          className,
        )}
        spellCheck={false}
        autoComplete="off"
        {...props}
      />
    )
  },
)
