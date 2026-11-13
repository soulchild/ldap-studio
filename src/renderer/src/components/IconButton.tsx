import type { ButtonHTMLAttributes } from 'react'
import { Button } from '@renderer/components/ui/button'
import { cn } from '@renderer/lib/utils'

/**
 * A small square button for pane and row actions. `label` is required: it is the accessible name
 * and, unless `title` says otherwise, the tooltip.
 */
export function IconButton({
  label,
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }): React.JSX.Element {
  return (
    <Button
      variant="quiet"
      size="icon"
      aria-label={label}
      title={label}
      className={cn('disabled:opacity-40', className)}
      {...props}
    />
  )
}
