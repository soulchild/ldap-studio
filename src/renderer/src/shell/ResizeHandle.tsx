import { Separator } from 'react-resizable-panels'
import { cn } from '@renderer/lib/utils'

/** A 1 px divider between panes; the hit area is wider than the line. */
export function ResizeHandle({ orientation }: { orientation: 'horizontal' | 'vertical' }): React.JSX.Element {
  return (
    <Separator
      className={cn(
        'relative shrink-0 bg-border transition-colors data-[separator=active]:bg-primary data-[separator=hover]:bg-border-strong',
        orientation === 'horizontal' ? 'w-px' : 'h-px',
      )}
    />
  )
}
