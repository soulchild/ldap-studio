import type { InputHTMLAttributes, ReactNode } from 'react'
import { cn } from '@renderer/lib/utils'

export function Checkbox({
  label,
  className,
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & { label: ReactNode }): React.JSX.Element {
  return (
    <label
      className={cn('inline-flex items-center gap-2 text-sm', props.disabled && 'opacity-50', className)}
    >
      <input type="checkbox" className="size-3.5 accent-primary" {...props} />
      {label}
    </label>
  )
}
