import type { ReactNode } from 'react'

/** Shown in a pane with nothing to display yet: says what will appear and how to get there. */
export function EmptyState({
  children,
  action,
}: {
  children: ReactNode
  action?: ReactNode
}): React.JSX.Element {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
      <p className="max-w-80 text-balance text-sm text-muted-foreground">{children}</p>
      {action}
    </div>
  )
}
