import type { ReactNode } from 'react'
import { cn } from '@renderer/lib/utils'

/** The title row at the top of a pane, with optional actions on the right. */
export function PaneHeader({
  title,
  actions,
  className,
}: {
  title: ReactNode
  actions?: ReactNode
  className?: string
}): React.JSX.Element {
  return (
    <header className={cn('flex h-9 shrink-0 items-center justify-between gap-2 px-3.5', className)}>
      <h2 className="truncate text-xs font-semibold text-foreground/85">{title}</h2>
      {actions ? <div className="flex items-center gap-1">{actions}</div> : null}
    </header>
  )
}
