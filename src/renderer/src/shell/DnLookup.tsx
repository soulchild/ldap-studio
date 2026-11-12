import { CornerDownLeft } from 'lucide-react'
import { useRef, useState } from 'react'
import { Button } from '@renderer/components/ui/button'
import { cn } from '@renderer/lib/utils'
import { useConnections } from '@renderer/state/connections'
import { useTree } from '@renderer/state/tree'
import { SHORTCUTS, shortcutText, useShortcut } from './shortcuts'
import { ancestorsOf, parseDn, serializeDn } from '@shared/dn'

type Outcome =
  | { kind: 'idle' }
  | { kind: 'working' }
  | { kind: 'error'; message: string }
  | { kind: 'missing'; dn: string; closest: string | undefined }

/** Jump to an entry by DN (directory-tree spec: DN lookup). Cmd/Ctrl+L focuses it. */
export function DnLookup(): React.JSX.Element {
  const [value, setValue] = useState('')
  const [outcome, setOutcome] = useState<Outcome>({ kind: 'idle' })
  const input = useRef<HTMLInputElement>(null)
  const connectionId = useConnections((store) => {
    const state = store.activeProfileId ? store.states[store.activeProfileId] : undefined
    return state?.status === 'connected' ? state.connectionId : undefined
  })

  useShortcut(SHORTCUTS.dnLookup, () => {
    input.current?.focus()
    input.current?.select()
  })

  const go = async (dn: string) => {
    const parsed = parseDn(dn)
    if (!parsed.ok || parsed.dn.length === 0) {
      setOutcome({
        kind: 'error',
        message: parsed.ok ? 'Enter a DN.' : `This is not a valid DN: ${parsed.error}.`,
      })
      return
    }
    if (!connectionId) {
      setOutcome({ kind: 'error', message: 'Connect to a server first.' })
      return
    }
    setOutcome({ kind: 'working' })
    const entry = await window.api.invoke('entry.read', { connectionId, dn, includeOperational: false })
    if (!entry.ok) {
      setOutcome({ kind: 'error', message: entry.error.message })
      return
    }
    if (entry.value === null) {
      setOutcome({ kind: 'missing', dn, closest: await closestExisting(connectionId, dn) })
      return
    }
    const revealed = await useTree.getState().reveal(connectionId, entry.value.dn)
    if (!revealed) {
      setOutcome({
        kind: 'error',
        message: 'This entry is outside the part of the directory shown in the tree.',
      })
      return
    }
    setOutcome({ kind: 'idle' })
    document.querySelector<HTMLElement>('[role="tree"]')?.focus()
  }

  return (
    <div className="relative min-w-0 flex-1">
      <form
        onSubmit={(event) => {
          event.preventDefault()
          void go(value.trim())
        }}
        className="flex items-center gap-2"
      >
        <input
          ref={input}
          aria-label="Go to DN"
          aria-invalid={outcome.kind === 'error' ? true : undefined}
          aria-describedby={
            outcome.kind === 'idle' || outcome.kind === 'working' ? undefined : 'dn-lookup-message'
          }
          value={value}
          onChange={(event) => {
            setValue(event.target.value)
            if (outcome.kind !== 'idle') {
              setOutcome({ kind: 'idle' })
            }
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              setOutcome({ kind: 'idle' })
              input.current?.blur()
            }
          }}
          placeholder={`Go to DN  ${shortcutText(SHORTCUTS.dnLookup)}`}
          spellCheck={false}
          className={cn(
            'h-8 w-full min-w-0 rounded-sm border border-input bg-surface px-2.5 font-mono text-sm',
            'placeholder:font-sans placeholder:text-subtle-foreground focus-visible:border-primary focus-visible:outline-none',
            'aria-invalid:border-destructive',
          )}
        />
        {outcome.kind === 'working' ? (
          <span role="status" className="shrink-0 text-xs text-muted-foreground">
            Looking up…
          </span>
        ) : (
          <CornerDownLeft className="size-4 shrink-0 text-subtle-foreground" aria-hidden />
        )}
      </form>
      {outcome.kind === 'error' || outcome.kind === 'missing' ? (
        <div
          id="dn-lookup-message"
          role="alert"
          className="absolute inset-x-0 top-full z-30 mt-1 rounded-md border bg-popover px-3 py-2.5 text-sm shadow-popover"
        >
          {outcome.kind === 'error' ? (
            <p className="text-destructive">{outcome.message}</p>
          ) : (
            <div className="flex flex-col gap-2">
              <p>No entry with this DN exists.</p>
              {outcome.closest ? (
                <div className="flex items-center gap-2">
                  <p className="min-w-0 text-xs text-muted-foreground">
                    The closest existing entry is{' '}
                    <span className="font-mono break-all text-foreground">{outcome.closest}</span>.
                  </p>
                  <Button
                    className="h-7 shrink-0"
                    onClick={() => {
                      setValue(outcome.closest ?? '')
                      void go(outcome.closest ?? '')
                    }}
                  >
                    Go there
                  </Button>
                </div>
              ) : null}
            </div>
          )}
        </div>
      ) : null}
    </div>
  )
}

/** Walks up from `dn` and returns the first ancestor that exists. */
async function closestExisting(connectionId: string, dn: string): Promise<string | undefined> {
  const parsed = parseDn(dn)
  if (!parsed.ok) {
    return undefined
  }
  for (const ancestor of ancestorsOf(parsed.dn).reverse()) {
    const candidate = serializeDn(ancestor)
    const result = await window.api.invoke('entry.read', {
      connectionId,
      dn: candidate,
      includeOperational: false,
    })
    if (result.ok && result.value) {
      return result.value.dn
    }
  }
  return undefined
}
