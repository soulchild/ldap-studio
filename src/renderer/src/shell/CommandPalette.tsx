import { Search } from 'lucide-react'
import { Dialog as Primitive } from 'radix-ui'
import { Fragment, useEffect, useId, useMemo, useState } from 'react'
import { cn } from '@renderer/lib/utils'
import { useUi } from '@renderer/state/ui'
import { buildCommands, matchCommands, type Command } from './commands'
import { keysOf } from './shortcuts'

/** Cmd/Ctrl+K: find a command by typing and run it with Enter (app-shell spec: command palette). */
export function CommandPalette(): React.JSX.Element {
  const open = useUi((store) => store.overlay === 'palette')
  return (
    <Primitive.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          useUi.getState().close()
        }
      }}
    >
      <Primitive.Portal>
        <Primitive.Overlay className="fixed inset-0 z-40 bg-black/20 dark:bg-black/40" />
        <Primitive.Content
          aria-describedby={undefined}
          className={cn(
            'fixed top-[14%] left-1/2 z-50 flex max-h-[70vh] w-[min(36rem,calc(100vw-2rem))] -translate-x-1/2 flex-col',
            'overflow-hidden rounded-lg border bg-surface-raised shadow-popover focus:outline-none',
          )}
        >
          <Primitive.Title className="sr-only">Command palette</Primitive.Title>
          {open ? <PaletteBody /> : null}
        </Primitive.Content>
      </Primitive.Portal>
    </Primitive.Root>
  )
}

function PaletteBody(): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const listId = useId()
  // The state when the palette opened decides what is offered.
  const commands = useMemo(() => buildCommands(), [])
  const shown = useMemo(() => matchCommands(commands, query), [commands, query])
  const optionId = (index: number) => `${listId}-${index}`

  useEffect(() => {
    document.getElementById(optionId(active))?.scrollIntoView({ block: 'nearest' })
    // optionId depends only on the stable listId.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active])

  const run = (command: Command | undefined) => {
    if (!command) {
      return
    }
    useUi.getState().close()
    // After the palette has closed, so a command can open another dialog.
    requestAnimationFrame(() => command.run())
  }

  return (
    <>
      <div className="flex items-center gap-2.5 border-b px-4">
        <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <input
          role="combobox"
          aria-label="Command"
          aria-expanded
          aria-controls={listId}
          aria-activedescendant={shown.length > 0 ? optionId(active) : undefined}
          autoFocus
          value={query}
          placeholder="Type a command"
          spellCheck={false}
          onChange={(event) => {
            setQuery(event.target.value)
            setActive(0)
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault()
              setActive((index) => Math.min(index + 1, shown.length - 1))
            } else if (event.key === 'ArrowUp') {
              event.preventDefault()
              setActive((index) => Math.max(index - 1, 0))
            } else if (event.key === 'Enter') {
              event.preventDefault()
              run(shown[active])
            }
          }}
          className="h-12 min-w-0 flex-1 bg-transparent text-sm placeholder:text-subtle-foreground focus:outline-none"
        />
      </div>
      <div id={listId} role="listbox" aria-label="Commands" className="min-h-0 overflow-y-auto p-1.5">
        {shown.length === 0 ? (
          <p className="px-3 py-6 text-center text-sm text-muted-foreground">No commands match.</p>
        ) : (
          shown.map((command, index) => {
            // Group headings while browsing; when typing, the best matches come first instead.
            const heading = query.trim() === '' && command.group !== shown[index - 1]?.group
            return (
              <Fragment key={command.id}>
                {heading ? (
                  <p
                    role="presentation"
                    className="px-2.5 pt-2.5 pb-1 text-xs font-medium text-muted-foreground first:pt-1"
                  >
                    {command.group}
                  </p>
                ) : null}
                <div
                  id={optionId(index)}
                  role="option"
                  aria-selected={index === active}
                  // The focus stays in the field.
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseMove={() => setActive(index)}
                  onClick={() => run(command)}
                  className={cn(
                    'flex h-9 cursor-default items-center gap-3 rounded-sm px-2.5 text-sm',
                    index === active ? 'bg-selection-strong text-foreground' : 'text-foreground',
                  )}
                >
                  <span className="min-w-0 flex-1 truncate">{command.title}</span>
                  {query.trim() !== '' ? (
                    <span className="shrink-0 text-xs text-subtle-foreground">{command.group}</span>
                  ) : null}
                  {command.shortcut ? (
                    <span className="flex shrink-0 gap-1" aria-hidden>
                      {keysOf(command.shortcut).map((key) => (
                        <kbd
                          key={key}
                          className="inline-flex h-5 min-w-5 items-center justify-center rounded-sm border bg-surface px-1 font-sans text-[0.6875rem] text-muted-foreground"
                        >
                          {key}
                        </kbd>
                      ))}
                    </span>
                  ) : null}
                </div>
              </Fragment>
            )
          })
        )}
      </div>
    </>
  )
}
