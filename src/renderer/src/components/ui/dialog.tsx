import { Dialog as Primitive } from 'radix-ui'
import type { ReactNode } from 'react'
import { cn } from '@renderer/lib/utils'

/** A modal dialog: title, optional description, body, and a footer with actions. */
export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  className,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: ReactNode
  description?: ReactNode
  children?: ReactNode
  footer?: ReactNode
  className?: string
}): React.JSX.Element {
  return (
    <Primitive.Root open={open} onOpenChange={onOpenChange}>
      <Primitive.Portal>
        <Primitive.Overlay className="fixed inset-0 z-40 bg-black/30 data-[state=open]:animate-in data-[state=open]:fade-in-0 dark:bg-black/50" />
        <Primitive.Content
          className={cn(
            'fixed top-1/2 left-1/2 z-50 flex max-h-[85vh] w-[min(32rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col',
            'rounded-lg border bg-surface-raised shadow-popover focus:outline-none',
            'data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-[0.98]',
            className,
          )}
          {...(description ? {} : { 'aria-describedby': undefined })}
        >
          <div className="px-5 pt-4 pb-1">
            <Primitive.Title className="text-lg font-semibold">{title}</Primitive.Title>
            {description ? (
              <Primitive.Description className="mt-1 text-sm text-muted-foreground">
                {description}
              </Primitive.Description>
            ) : null}
          </div>
          {children ? <div className="min-h-0 overflow-y-auto px-5 py-3.5">{children}</div> : null}
          {footer ? (
            <div className="flex items-center justify-end gap-2 border-t px-5 py-3">{footer}</div>
          ) : null}
        </Primitive.Content>
      </Primitive.Portal>
    </Primitive.Root>
  )
}
