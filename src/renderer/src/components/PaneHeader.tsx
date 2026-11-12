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
    <header className={cn('flex h-10 shrink-0 items-center justify-between gap-2 px-4', className)}>
      <h2 className="text-xs font-medium text-muted-foreground">{title}</h2>
      {actions ? <div className="flex items-center gap-1">{actions}</div> : null}
    </header>
  )
}
