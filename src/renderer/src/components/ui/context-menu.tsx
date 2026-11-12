import { ContextMenu as Primitive } from 'radix-ui'
import type { ReactNode } from 'react'
import { cn } from '@renderer/lib/utils'
import type { MenuItem } from './dropdown-menu'

/** A right-click menu around its child. */
export function ContextMenu({
  children,
  items,
  label,
}: {
  children: ReactNode
  items: (MenuItem | 'separator')[]
  label: string
}): React.JSX.Element {
  return (
    <Primitive.Root>
      <Primitive.Trigger asChild>{children}</Primitive.Trigger>
      <Primitive.Portal>
        <Primitive.Content
          aria-label={label}
          className="z-50 min-w-44 rounded-md border bg-popover p-1 text-sm shadow-popover data-[state=open]:animate-in data-[state=open]:fade-in-0"
        >
          {items.map((item, index) =>
            item === 'separator' ? (
              <Primitive.Separator key={`separator-${index}`} className="my-1 h-px bg-border" />
            ) : (
              <Primitive.Item
                key={item.label}
                disabled={item.disabled}
                onSelect={item.onSelect}
                className={cn(
                  'flex h-8 cursor-default items-center rounded-sm px-2 outline-none select-none',
                  'data-[highlighted]:bg-hover data-[disabled]:opacity-40',
                  item.destructive && 'text-destructive',
                )}
              >
                {item.label}
              </Primitive.Item>
            ),
          )}
        </Primitive.Content>
      </Primitive.Portal>
    </Primitive.Root>
  )
}
