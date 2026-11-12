import { Dialog } from '@renderer/components/ui/dialog'
import { isMac, keysOf, SHORTCUTS, type Shortcut } from './shortcuts'

const mod = isMac ? '⌘' : 'Ctrl'

/** Keys handled by the focused tree or field; listed so the overlay is the one reference. */
const LOCAL_KEYS: { keys: string[]; description: string }[] = [
  { keys: ['↑', '↓'], description: 'Move through the tree' },
  { keys: ['→', '←'], description: 'Expand or collapse the selected entry' },
  { keys: [mod, 'C'], description: 'Copy the selected entry’s DN' },
  { keys: ['Enter'], description: 'Run the search from the filter field' },
]

const GLOBAL: Shortcut[] = [
  SHORTCUTS.dnLookup,
  SHORTCUTS.search,
  SHORTCUTS.save,
  SHORTCUTS.discard,
  SHORTCUTS.help,
]

/** The keyboard shortcuts overlay (app-shell spec: keyboard navigation). */
export function ShortcutsDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}): React.JSX.Element {
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Keyboard shortcuts">
      <div className="flex flex-col gap-6">
        <ShortcutList
          title="Anywhere"
          rows={GLOBAL.map((shortcut) => ({ keys: keysOf(shortcut), description: shortcut.description }))}
        />
        <ShortcutList title="In the tree and the search" rows={LOCAL_KEYS} />
      </div>
    </Dialog>
  )
}

function ShortcutList({
  title,
  rows,
}: {
  title: string
  rows: { keys: string[]; description: string }[]
}): React.JSX.Element {
  return (
    <section aria-label={title} className="flex flex-col gap-3">
      <h2 className="text-xs font-medium text-muted-foreground">{title}</h2>
      <dl className="flex flex-col gap-3 text-sm">
        {rows.map((row) => (
          <div key={row.description} className="flex items-center justify-between gap-6">
            <dt className="text-foreground">{row.description}</dt>
            <dd className="flex shrink-0 gap-1" aria-label={row.keys.join(' ')}>
              {row.keys.map((key) => (
                <kbd
                  key={key}
                  className="inline-flex h-6 min-w-6 items-center justify-center rounded-sm border bg-surface px-1.5 font-sans text-xs text-muted-foreground"
                >
                  {key}
                </kbd>
              ))}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  )
}
