import { Separator } from 'react-resizable-panels'
import { cn } from '@renderer/lib/utils'

/**
 * The gap between two panes, with a small grip in the middle; the whole gap can be dragged.
 * The grip darkens on hover and takes the accent while dragging.
 */
export function ResizeHandle({ orientation }: { orientation: 'horizontal' | 'vertical' }): React.JSX.Element {
  return (
    <Separator
      className={cn(
        'group/handle relative flex shrink-0 items-center justify-center outline-none',
        orientation === 'horizontal' ? 'w-1.5' : 'h-1.5',
      )}
    >
      <span
        aria-hidden
        className={cn(
          'rounded-full bg-border-strong transition-colors',
          'group-data-[separator=hover]/handle:bg-subtle-foreground group-data-[separator=active]/handle:bg-primary',
          orientation === 'horizontal' ? 'h-8 w-1' : 'h-1 w-8',
        )}
      />
    </Separator>
  )
}
