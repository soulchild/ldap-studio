import { Popover } from 'radix-ui'
import { useEffect, useId, useMemo, useState } from 'react'
import { cn } from '@renderer/lib/utils'
import { filterOptions } from './filter-options'

/**
 * A text field with a scrollable list of suggestions (the native datalist popup cannot be
 * scrolled or styled in Electron). Free text is allowed; Enter submits the highlighted option,
 * or the typed text when nothing is highlighted.
 */
export function Combobox({
  label,
  value,
  options,
  placeholder,
  className,
  autoFocus = false,
  onChange,
  onSubmit,
  onCancel,
}: {
  label: string
  value: string
  options: readonly string[]
  placeholder?: string
  className?: string
  /** Focus the field and show the list right away. */
  autoFocus?: boolean
  onChange: (value: string) => void
  onSubmit: (value: string) => void
  onCancel: () => void
}): React.JSX.Element {
  const listId = useId()
  const [open, setOpen] = useState(autoFocus)
  const [active, setActive] = useState(-1)
  const matches = useMemo(() => filterOptions(options, value), [options, value])
  const showList = open && matches.length > 0
  const optionId = (index: number) => `${listId}-option-${index}`

  useEffect(() => {
    if (active >= 0) {
      document.getElementById(optionId(active))?.scrollIntoView({ block: 'nearest' })
    }
    // optionId depends only on the stable listId.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active])

  const choose = (option: string) => {
    onChange(option)
    onSubmit(option)
  }

  return (
    <Popover.Root open={showList} onOpenChange={setOpen}>
      <Popover.Anchor asChild>
        <input
          role="combobox"
          aria-label={label}
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={showList && active >= 0 ? optionId(active) : undefined}
          value={value}
          autoFocus={autoFocus}
          placeholder={placeholder}
          spellCheck={false}
          autoComplete="off"
          // Options are clicked without taking the focus, so a blur means the user moved on.
          onBlur={() => {
            setOpen(false)
            setActive(-1)
          }}
          onChange={(event) => {
            onChange(event.target.value)
            setActive(-1)
            setOpen(true)
          }}
          onKeyDown={(event) => {
            switch (event.key) {
              case 'ArrowDown':
                event.preventDefault()
                setOpen(true)
                setActive((index) => Math.min(index + 1, matches.length - 1))
                break
              case 'ArrowUp':
                event.preventDefault()
                setActive((index) => Math.max(index - 1, -1))
                break
              case 'Enter': {
                event.preventDefault()
                const highlighted = showList && active >= 0 ? matches[active] : undefined
                if (highlighted) {
                  choose(highlighted)
                } else {
                  onSubmit(value)
                }
                break
              }
              case 'Escape':
                event.preventDefault()
                if (showList && active >= 0) {
                  setActive(-1)
                  setOpen(false)
                } else {
                  onCancel()
                }
                break
            }
          }}
          className={cn(
            'h-8 rounded-sm border border-input bg-surface px-2.5 text-sm focus-visible:border-primary focus-visible:outline-none',
            className,
          )}
        />
      </Popover.Anchor>
      <Popover.Portal>
        <Popover.Content
          // A list of options, not a dialog: the workspace treats open dialogs as modal.
          role="listbox"
          id={listId}
          aria-label={label}
          side="bottom"
          align="start"
          sideOffset={4}
          collisionPadding={8}
          // Typing continues in the field while the list is open.
          onOpenAutoFocus={(event) => event.preventDefault()}
          onCloseAutoFocus={(event) => event.preventDefault()}
          // Escape is handled by the field, which decides between closing the list and cancelling.
          onEscapeKeyDown={(event) => event.preventDefault()}
          // Clicking an option or dragging the scrollbar keeps the focus in the field.
          onMouseDown={(event) => event.preventDefault()}
          className="z-50 w-(--radix-popover-trigger-width) min-w-64 rounded-md border bg-popover shadow-popover"
        >
          <ul
            role="presentation"
            className="max-h-[min(16rem,var(--radix-popover-content-available-height))] overflow-y-auto py-1"
          >
            {matches.map((option, index) => (
              <li
                key={option}
                id={optionId(index)}
                role="option"
                aria-selected={index === active}
                onClick={() => choose(option)}
                onMouseMove={() => setActive(index)}
                className={cn(
                  'cursor-default truncate px-2.5 py-1 font-mono text-sm',
                  index === active ? 'bg-selection-strong text-foreground' : 'text-foreground',
                )}
              >
                {option}
              </li>
            ))}
          </ul>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
