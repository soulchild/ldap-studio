import { useState } from 'react'
import { Button } from '@renderer/components/ui/button'
import { Dialog } from '@renderer/components/ui/dialog'
import { cn } from '@renderer/lib/utils'
import { useConnections } from '@renderer/state/connections'
import { useTree } from '@renderer/state/tree'
import { useUi } from '@renderer/state/ui'
import { ancestorsOf, parseDn, serializeDn } from '@shared/dn'

type Outcome =
  | { kind: 'idle' }
  | { kind: 'working' }
  | { kind: 'error'; message: string }
  | { kind: 'missing'; closest: string | undefined }

/**
 * Jump to an entry by DN (directory-tree spec: DN lookup), opened with Cmd/Ctrl+L or from the
 * command palette. On success the entry is revealed and selected in the tree.
 */
export function GoToDnDialog(): React.JSX.Element {
  const open = useUi((store) => store.overlay === 'goToDn')
  const close = useUi((store) => store.close)
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          close()
        }
      }}
      title="Go to DN"
      className="top-[18%] translate-y-0"
      // Back to the tree, where the entry now is selected.
      onCloseAutoFocus={(event) => {
        event.preventDefault()
        document.querySelector<HTMLElement>('[role="tree"]')?.focus()
      }}
    >
      {open ? <GoToDnForm onDone={close} /> : null}
    </Dialog>
  )
}

function GoToDnForm({ onDone }: { onDone: () => void }): React.JSX.Element {
  const [value, setValue] = useState('')
  const [outcome, setOutcome] = useState<Outcome>({ kind: 'idle' })
  const connectionId = useConnections((store) => {
    const state = store.activeProfileId ? store.states[store.activeProfileId] : undefined
    return state?.status === 'connected' ? state.connectionId : undefined
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
      setOutcome({ kind: 'missing', closest: await closestExisting(connectionId, dn) })
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
    onDone()
  }

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault()
        void go(value.trim())
      }}
    >
      <input
        aria-label="Go to DN"
        aria-invalid={outcome.kind === 'error' ? true : undefined}
        aria-describedby={
          outcome.kind === 'error' || outcome.kind === 'missing' ? 'go-to-dn-message' : undefined
        }
        autoFocus
        value={value}
        placeholder="uid=jdoe,ou=people,dc=example,dc=com"
        spellCheck={false}
        onChange={(event) => {
          setValue(event.target.value)
          if (outcome.kind !== 'idle') {
            setOutcome({ kind: 'idle' })
          }
        }}
        className={cn(
          'h-9 w-full min-w-0 rounded-sm border border-input bg-surface px-3 font-mono text-sm',
          'placeholder:text-subtle-foreground focus-visible:border-primary focus-visible:outline-none',
          'aria-invalid:border-destructive',
        )}
      />
      {outcome.kind === 'working' ? (
        <p role="status" className="text-xs text-muted-foreground">
          Looking up…
        </p>
      ) : outcome.kind === 'error' ? (
        <p id="go-to-dn-message" role="alert" className="text-sm text-destructive">
          {outcome.message}
        </p>
      ) : outcome.kind === 'missing' ? (
        <div id="go-to-dn-message" role="alert" className="flex flex-col gap-2 text-sm">
          <p>No entry with this DN exists.</p>
          {outcome.closest ? (
            <div className="flex items-center gap-3">
              <p className="min-w-0 flex-1 text-xs text-muted-foreground">
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
      ) : (
        <p className="text-xs text-muted-foreground">Press Enter to open the entry in the tree.</p>
      )}
    </form>
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
