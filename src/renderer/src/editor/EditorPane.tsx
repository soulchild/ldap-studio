import { MoreHorizontal } from 'lucide-react'
import { useEffect, useState } from 'react'
import { EmptyState } from '@renderer/components/EmptyState'
import { Button } from '@renderer/components/ui/button'
import { Checkbox } from '@renderer/components/ui/checkbox'
import { Dialog } from '@renderer/components/ui/dialog'
import { DropdownMenu } from '@renderer/components/ui/dropdown-menu'
import { IconButton } from '@renderer/components/IconButton'
import { useEntryActions, type EntryAction } from '@renderer/state/actions'
import { useConnections } from '@renderer/state/connections'
import { useEditor } from '@renderer/state/editor'
import { NO_SCHEMA, useSchema } from '@renderer/state/schema'
import { useTree } from '@renderer/state/tree'
import { SHORTCUTS, shortcutText, useShortcut } from '@renderer/shell/shortcuts'
import { keyOf } from '@renderer/tree/model'
import { describeBinary } from '@shared/binary'
import { parseDn } from '@shared/dn'
import type { Modification } from '@shared/entry'
import { AttributeTable } from './AttributeTable'
import { changedAttributeCount } from './model'
import { DnPath } from './DnPath'

/** Follows the tree selection of the active connection and shows that entry (entry-editing spec). */
export function EditorPane(): React.JSX.Element {
  const activeState = useConnections((store) =>
    store.activeProfileId ? store.states[store.activeProfileId] : undefined,
  )
  const connectionId =
    activeState?.status === 'connected' || activeState?.status === 'error'
      ? activeState.connectionId
      : undefined
  const selectedDn = useTree((store) => {
    const key = connectionId ? store.selected[connectionId] : undefined
    return key && connectionId ? store.trees[connectionId]?.nodes[key]?.dn : undefined
  })
  const editor = useEditor()
  const schema =
    useSchema((store) => (editor.entry ? store.schemas[editor.entry.connectionId] : undefined)) ?? NO_SCHEMA
  const entryConnectionLive = useConnections((store) =>
    Object.values(store.states).some(
      (state) => state.status === 'connected' && state.connectionId === editor.entry?.connectionId,
    ),
  )
  const [previewing, setPreviewing] = useState(false)

  useEffect(() => {
    if (connectionId && selectedDn) {
      editor.requestOpen(connectionId, selectedDn)
    }
    // Only react to a new selection; the store decides whether to open it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectionId, selectedDn])

  // The entry's connection was closed: nothing to show any more.
  const entryGone =
    editor.entry !== undefined &&
    !useConnections.getState().profiles.some((profile) => {
      const state = useConnections.getState().states[profile.id]
      return (
        (state?.status === 'connected' || state?.status === 'error') &&
        state.connectionId === editor.entry?.connectionId
      )
    })
  useEffect(() => {
    if (entryGone) {
      editor.close()
    }
  }, [entryGone, editor])

  // Cmd/Ctrl+S saves the way the footer's primary button does; the review dialog still asks first.
  useShortcut(SHORTCUTS.save, () => {
    const store = useEditor.getState()
    if (!store.entry || !entryConnectionLive || store.saving) {
      return
    }
    if (store.entry.draft) {
      void store.save()
    } else if (store.pendingChanges().length > 0 && store.check()) {
      setPreviewing(true)
    }
  })
  useShortcut(SHORTCUTS.discard, () => {
    const store = useEditor.getState()
    if (store.entry && !store.entry.draft && store.pendingChanges().length > 0) {
      store.discard()
    }
  })

  // The pane is always the "Entry" region, so the landmark does not come and go.
  const placeholder = (text: React.ReactNode) => (
    <section className="h-full" aria-label="Entry">
      <EmptyState>{text}</EmptyState>
    </section>
  )
  if (editor.status === 'loading' && !editor.entry) {
    return placeholder('Loading the entry…')
  }
  if (editor.status === 'missing') {
    return placeholder('This entry no longer exists on the server.')
  }
  if (editor.status === 'error') {
    return placeholder(editor.loadError)
  }
  const entry = editor.entry
  if (!entry) {
    return placeholder('Select an entry in the directory to see its attributes.')
  }

  const readOnly = !entryConnectionLive
  const tree = useTree.getState().trees[entry.connectionId]
  const rootDns = tree ? tree.rootKeys.map((key) => tree.nodes[key]?.dn ?? key) : []
  const pending = editor.pendingChanges()
  const draft = entry.draft
  const title = draft
    ? 'New entry'
    : (() => {
        const parsed = parseDn(entry.dn)
        return parsed.ok ? (parsed.dn[0]?.[0]?.value ?? entry.dn) : entry.dn
      })()
  const act = (kind: EntryAction) =>
    useEntryActions.getState().start({ kind, connectionId: entry.connectionId, dn: entry.dn })
  const openAncestor = (dn: string) => {
    void useTree.getState().reveal(entry.connectionId, dn)
  }

  return (
    <section className="flex h-full flex-col" aria-label="Entry">
      <header className="flex shrink-0 flex-col gap-2 px-6 pt-5 pb-4">
        <DnPath dn={entry.dn} rootDns={rootDns} onOpen={openAncestor} />
        <div className="flex items-end justify-between gap-4">
          <h1 className="selectable min-w-0 truncate text-lg font-semibold">{title}</h1>
          {draft ? null : (
            <div className="flex shrink-0 items-center gap-2">
              <Checkbox
                className="text-xs text-muted-foreground"
                label="Show operational attributes"
                checked={editor.includeOperational}
                disabled={pending.length > 0}
                onChange={(event) => void editor.setOperational(event.target.checked)}
              />
              <DropdownMenu
                label="Entry actions"
                trigger={
                  <IconButton label="Entry actions">
                    <MoreHorizontal className="size-4" />
                  </IconButton>
                }
                items={[
                  { label: 'New child entry…', onSelect: () => act('create'), disabled: readOnly },
                  { label: 'Copy entry…', onSelect: () => act('copy'), disabled: readOnly },
                  { label: 'Rename…', onSelect: () => act('rename'), disabled: readOnly },
                  { label: 'Move…', onSelect: () => act('move'), disabled: readOnly },
                  'separator',
                  { label: 'Delete…', onSelect: () => act('delete'), disabled: readOnly, destructive: true },
                ]}
              />
            </div>
          )}
        </div>
        {readOnly ? (
          <p role="status" className="rounded-sm border border-warning/40 px-3 py-2 text-xs text-warning">
            The connection was lost. This entry cannot be changed until you reconnect.
          </p>
        ) : !schema.available && schema.reason ? (
          <p role="status" className="text-xs text-muted-foreground">
            {schema.reason}
          </p>
        ) : null}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto border-t">
        <AttributeTable
          original={entry.original}
          working={entry.working}
          schema={schema.model}
          readOnly={readOnly}
          problems={editor.problems}
          onChange={editor.edit}
        />
      </div>

      {pending.length > 0 || editor.saveError || draft ? (
        <footer className="flex shrink-0 items-center gap-3 border-t bg-background px-6 py-3">
          <div className="min-w-0 flex-1 text-sm">
            {editor.saveError ? (
              <p role="alert" className="text-destructive">
                {editor.saveError}
              </p>
            ) : editor.problems.size > 0 ? (
              <p role="alert" className="text-destructive">
                {editor.problems.size === 1
                  ? 'Fix 1 problem to save.'
                  : `Fix ${editor.problems.size} problems to save.`}
              </p>
            ) : draft ? (
              <p>Not created yet. Fill in the attributes, then create the entry.</p>
            ) : (
              <p>{unsavedLabel(changedAttributeCount(pending))}</p>
            )}
          </div>
          {draft ? (
            <>
              <Button onClick={editor.close}>Cancel</Button>
              <Button
                variant="primary"
                disabled={readOnly || editor.saving}
                title={shortcutText(SHORTCUTS.save)}
                onClick={() => void editor.save()}
              >
                {editor.saving ? 'Creating…' : 'Create entry'}
              </Button>
            </>
          ) : (
            <>
              <Button
                onClick={editor.discard}
                disabled={pending.length === 0}
                title={shortcutText(SHORTCUTS.discard)}
              >
                Discard
              </Button>
              <Button
                variant="primary"
                disabled={pending.length === 0 || readOnly}
                title={shortcutText(SHORTCUTS.save)}
                onClick={() => {
                  if (editor.check()) {
                    setPreviewing(true)
                  }
                }}
              >
                Review and save…
              </Button>
            </>
          )}
        </footer>
      ) : null}

      <PreviewDialog
        open={previewing}
        changes={pending}
        saving={editor.saving}
        onCancel={() => setPreviewing(false)}
        onSave={async () => {
          await editor.save()
          setPreviewing(false)
        }}
      />
      <StaleDialog />
      <GuardDialog
        connectionId={entry.connectionId}
        title={title}
        changeCount={changedAttributeCount(pending)}
      />
    </section>
  )
}

const OPERATION_LABELS: Record<Modification['operation'], string> = {
  add: 'Add',
  replace: 'Replace',
  delete: 'Delete',
}

function PreviewDialog({
  open,
  changes,
  saving,
  onCancel,
  onSave,
}: {
  open: boolean
  changes: Modification[]
  saving: boolean
  onCancel: () => void
  onSave: () => void
}): React.JSX.Element {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => !next && onCancel()}
      title="Review changes"
      description="These changes are sent as one modification. The server applies all of them or none."
      footer={
        <>
          <Button onClick={onCancel}>Cancel</Button>
          <Button variant="primary" onClick={onSave} disabled={saving}>
            {saving ? 'Saving…' : 'Save changes'}
          </Button>
        </>
      }
    >
      <ul aria-label="Changes" className="flex flex-col gap-2 text-sm">
        {changes.map((change, index) => (
          <li key={index} className="flex gap-3">
            <span className="w-16 shrink-0 text-muted-foreground">{OPERATION_LABELS[change.operation]}</span>
            <span className="min-w-0">
              <span className="font-medium">{change.attribute}</span>
              {change.values.length === 0 ? (
                <span className="text-muted-foreground"> (all values)</span>
              ) : (
                <span className="mt-0.5 flex flex-col font-mono text-xs break-all text-muted-foreground">
                  {change.values.map((value, valueIndex) => (
                    <span key={valueIndex}>
                      {typeof value === 'string' ? value : describeBinary(change.attribute, value)}
                    </span>
                  ))}
                </span>
              )}
            </span>
          </li>
        ))}
      </ul>
    </Dialog>
  )
}

function StaleDialog(): React.JSX.Element {
  const stale = useEditor((store) => store.stale)
  const { reload, save } = useEditor.getState()
  return (
    <Dialog
      open={stale}
      onOpenChange={(next) => !next && useEditor.setState({ stale: false })}
      title="This entry was changed on the server"
      description="It changed after you opened it. Reload to see the current version, which discards your changes, or overwrite the server's version with your changes."
      footer={
        <>
          <Button onClick={() => useEditor.setState({ stale: false })}>Cancel</Button>
          <Button onClick={() => void reload()}>Reload</Button>
          <Button variant="destructive" onClick={() => void save({ overwrite: true })}>
            Overwrite
          </Button>
        </>
      }
    />
  )
}

function GuardDialog({
  connectionId,
  title,
  changeCount,
}: {
  connectionId: string
  title: string
  changeCount: number
}): React.JSX.Element {
  const guard = useEditor((store) => store.guard)
  const entryDn = useEditor((store) => store.entry?.dn)
  const choose = async (choice: 'save' | 'discard' | 'stay') => {
    const opened = await useEditor.getState().resolveGuard(choice)
    if (!opened && entryDn) {
      // Stayed (or saving failed): put the tree selection back on the open entry.
      useTree.getState().select(connectionId, keyOf(entryDn))
    }
  }
  return (
    <Dialog
      open={guard !== undefined}
      onOpenChange={(next) => !next && void choose('stay')}
      title={`Save changes to ${title}?`}
      description={`You have ${unsavedLabel(changeCount)}.`}
      footer={
        <>
          <Button onClick={() => void choose('stay')}>Stay</Button>
          <Button onClick={() => void choose('discard')}>Discard</Button>
          <Button variant="primary" onClick={() => void choose('save')}>
            Save
          </Button>
        </>
      }
    />
  )
}

function unsavedLabel(count: number): string {
  return count === 1 ? '1 unsaved change' : `${count} unsaved changes`
}
