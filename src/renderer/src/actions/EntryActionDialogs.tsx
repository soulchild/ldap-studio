import { useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@renderer/components/ui/button'
import { Checkbox } from '@renderer/components/ui/checkbox'
import { Dialog } from '@renderer/components/ui/dialog'
import { Field } from '@renderer/components/ui/field'
import { Input } from '@renderer/components/ui/input'
import { cn } from '@renderer/lib/utils'
import { useEntryActions, type ActionRequest } from '@renderer/state/actions'
import { useEditor } from '@renderer/state/editor'
import { NO_SCHEMA, useSchema } from '@renderer/state/schema'
import { useTree } from '@renderer/state/tree'
import { keyOf } from '@renderer/tree/model'
import { escapeDnValue, isValidDn } from '@shared/dn'
import type { AppError } from '@shared/ipc'
import type { SchemaModel } from '@shared/schema-model'
import { afterRelocation, isWithin, parentOf, rdnOf, splitRdn } from './helpers'

const count = new Intl.NumberFormat()

/** Hosts the dialog of the entry action in progress (create, copy, rename, move, delete). */
export function EntryActionDialogs(): React.JSX.Element | null {
  const request = useEntryActions((store) => store.request)
  const close = useEntryActions((store) => store.close)
  if (!request) {
    return null
  }
  const props = { request, onClose: close }
  // A key per request resets the dialog's form when another action starts.
  const key = `${request.kind}:${request.dn}:${request.newParent ?? ''}`
  switch (request.kind) {
    case 'create':
      return <CreateDialog key={key} {...props} />
    case 'copy':
      return <CopyDialog key={key} {...props} />
    case 'rename':
      return <RenameDialog key={key} {...props} />
    case 'move':
      return <MoveDialog key={key} {...props} />
    case 'delete':
      return <DeleteDialog key={key} {...props} />
    case 'reload':
      return <ReloadDialog key={key} {...props} />
  }
}

interface DialogProps {
  request: ActionRequest
  onClose: () => void
}

function errorText(error: AppError): string {
  return error.kind === 'ldap' && error.diagnostic && error.diagnostic !== error.message
    ? `${error.message} (${error.diagnostic})`
    : error.message
}

// ---------------------------------------------------------------------------
// New entry
// ---------------------------------------------------------------------------

/** Object classes with their superiors, top first, each once. */
function withSuperiors(schema: SchemaModel, classes: string[]): string[] {
  const names: string[] = []
  for (const name of classes) {
    for (const objectClass of [...schema.superiorChain(name)].reverse()) {
      const canonical = objectClass.names[0] ?? name
      if (!names.some((existing) => existing.toLowerCase() === canonical.toLowerCase())) {
        names.push(canonical)
      }
    }
  }
  return names
}

function CreateDialog({ request, onClose }: DialogProps): React.JSX.Element {
  const schema = useSchema((store) => store.schemas[request.connectionId]) ?? NO_SCHEMA
  const model = schema.model
  const [query, setQuery] = useState('')
  const [chosen, setChosen] = useState<string[]>([])
  const [typedClasses, setTypedClasses] = useState('')
  const [rdnAttribute, setRdnAttribute] = useState('')
  const [rdnValue, setRdnValue] = useState('')
  const [submitted, setSubmitted] = useState(false)

  const classes = useMemo(
    () =>
      model.snapshot.objectClasses
        .filter(
          (objectClass) => objectClass.kind !== 'abstract' && !objectClass.obsolete && objectClass.names[0],
        )
        .map((objectClass) => ({ name: objectClass.names[0] as string, kind: objectClass.kind }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [model],
  )
  const selected = schema.available
    ? chosen
    : typedClasses
        .split(',')
        .map((name) => name.trim())
        .filter(Boolean)
  const hasStructural =
    !schema.available || selected.some((name) => model.objectClass(name)?.kind === 'structural')
  const allowed = model.allowedAttributes(selected)
  const rdnOptions = [...allowed.required, ...allowed.optional].filter((name) => name !== 'objectClass')
  const effectiveRdn =
    rdnAttribute ||
    (rdnOptions.includes('cn') ? 'cn' : (allowed.required.find((name) => name !== 'objectClass') ?? ''))

  const errors = {
    classes:
      selected.length === 0
        ? 'Choose at least one object class.'
        : !hasStructural
          ? 'Choose a structural object class, such as inetOrgPerson. Auxiliary classes can only be added to one.'
          : undefined,
    rdn: effectiveRdn === '' ? 'Choose the attribute that names the entry.' : undefined,
    value: rdnValue.trim() === '' ? 'Enter the value that names the entry.' : undefined,
  }
  const valid = Object.values(errors).every((error) => error === undefined)

  const submit = () => {
    setSubmitted(true)
    if (!valid) {
      return
    }
    const objectClasses = schema.available ? withSuperiors(model, selected) : selected
    const required = model.allowedAttributes(objectClasses).required.filter((name) => name !== 'objectClass')
    const working = [
      { name: 'objectClass', values: objectClasses },
      ...[...new Set([effectiveRdn, ...required])].map((name) => ({
        name,
        values: [name.toLowerCase() === effectiveRdn.toLowerCase() ? rdnValue.trim() : ''],
      })),
    ]
    useEditor.getState().startDraft({
      connectionId: request.connectionId,
      parentDn: request.dn,
      rdnAttribute: effectiveRdn,
      rdnValue: rdnValue.trim(),
      working,
    })
    onClose()
  }

  const visible = classes.filter((objectClass) =>
    objectClass.name.toLowerCase().includes(query.toLowerCase()),
  )

  return (
    <Dialog
      open
      onOpenChange={(next) => !next && onClose()}
      title="New entry"
      description={
        <>
          Parent: <span className="font-mono break-all">{request.dn}</span>.
        </>
      }
      className="w-[min(36rem,calc(100vw-2rem))]"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="create-entry">
            Continue
          </Button>
        </>
      }
    >
      <form
        id="create-entry"
        className="flex flex-col gap-5"
        onSubmit={(event) => {
          event.preventDefault()
          submit()
        }}
      >
        {schema.available ? (
          <div className="flex flex-col gap-2">
            <span className="text-xs font-medium text-muted-foreground">Object classes</span>
            <Input
              aria-label="Find object classes"
              placeholder="Find object classes"
              value={query}
              autoFocus
              onChange={(event) => setQuery(event.target.value)}
            />
            <ul
              aria-label="Object classes"
              className="flex h-48 flex-col overflow-y-auto rounded-sm border py-1"
            >
              {visible.map((objectClass) => (
                <li key={objectClass.name}>
                  <label className="flex h-8 items-center gap-2 px-3 text-sm hover:bg-hover">
                    <input
                      type="checkbox"
                      className="size-3.5 accent-primary"
                      checked={chosen.includes(objectClass.name)}
                      onChange={(event) =>
                        setChosen(
                          event.target.checked
                            ? [...chosen, objectClass.name]
                            : chosen.filter((name) => name !== objectClass.name),
                        )
                      }
                    />
                    <span className="flex-1">{objectClass.name}</span>
                    <span className="text-xs text-subtle-foreground">{objectClass.kind}</span>
                  </label>
                </li>
              ))}
            </ul>
            {submitted && errors.classes ? (
              <p className="text-xs text-destructive">{errors.classes}</p>
            ) : (
              <p className="text-xs text-muted-foreground">
                {chosen.length > 0
                  ? `Chosen: ${chosen.join(', ')}`
                  : 'Choose one structural class and any auxiliary classes.'}
              </p>
            )}
          </div>
        ) : (
          <Field
            label="Object classes"
            htmlFor="create-classes"
            hint="Separate several with commas. The schema is not available, so they cannot be suggested."
            error={submitted ? errors.classes : undefined}
          >
            <Input
              id="create-classes"
              mono
              value={typedClasses}
              autoFocus
              onChange={(event) => setTypedClasses(event.target.value)}
            />
          </Field>
        )}

        <div className="grid grid-cols-[12rem_1fr] gap-3">
          <Field label="Named by" htmlFor="create-rdn-attribute" error={submitted ? errors.rdn : undefined}>
            {schema.available ? (
              <select
                id="create-rdn-attribute"
                value={effectiveRdn}
                onChange={(event) => setRdnAttribute(event.target.value)}
                className="h-8 rounded-sm border border-input bg-surface pl-2 text-sm"
              >
                {rdnOptions.length === 0 ? <option value="">Choose classes first</option> : null}
                {rdnOptions.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            ) : (
              <Input
                id="create-rdn-attribute"
                mono
                value={rdnAttribute}
                onChange={(event) => setRdnAttribute(event.target.value)}
              />
            )}
          </Field>
          <Field label="Name" htmlFor="create-rdn-value" error={submitted ? errors.value : undefined}>
            <Input
              id="create-rdn-value"
              value={rdnValue}
              onChange={(event) => setRdnValue(event.target.value)}
            />
          </Field>
        </div>
        {effectiveRdn && rdnValue.trim() ? (
          <p className="text-xs text-muted-foreground">
            New DN{' '}
            <span className="font-mono break-all text-foreground">
              {effectiveRdn}={escapeDnValue(rdnValue.trim())},{request.dn}
            </span>
          </p>
        ) : null}
      </form>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// Copy
// ---------------------------------------------------------------------------

function CopyDialog({ request, onClose }: DialogProps): React.JSX.Element {
  const source = splitRdn(rdnOf(request.dn))
  const [value, setValue] = useState(source ? `${source.value} (copy)` : '')
  const [parent, setParent] = useState(parentOf(request.dn))
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    if (!source) {
      setError('Entries with a multi-valued name cannot be copied yet.')
      return
    }
    if (value.trim() === '' || !isValidDn(parent)) {
      setError(value.trim() === '' ? 'Enter a name for the copy.' : 'The parent is not a valid DN.')
      return
    }
    setBusy(true)
    const result = await window.api.invoke('entry.read', {
      connectionId: request.connectionId,
      dn: request.dn,
      includeOperational: false,
    })
    setBusy(false)
    if (!result.ok || !result.value) {
      setError(result.ok ? 'The entry no longer exists.' : errorText(result.error))
      return
    }
    const newValue = value.trim()
    const working = result.value.attributes.map((attribute) =>
      attribute.name.toLowerCase() === source.attribute.toLowerCase()
        ? {
            ...attribute,
            values: [
              newValue,
              ...attribute.values.filter((current) => current !== source.value && current !== newValue),
            ],
          }
        : attribute,
    )
    if (!working.some((attribute) => attribute.name.toLowerCase() === source.attribute.toLowerCase())) {
      working.push({ name: source.attribute, values: [newValue] })
    }
    useEditor.getState().startDraft({
      connectionId: request.connectionId,
      parentDn: parent.trim(),
      rdnAttribute: source.attribute,
      rdnValue: newValue,
      working,
    })
    onClose()
  }

  return (
    <Dialog
      open
      onOpenChange={(next) => !next && onClose()}
      title="Copy entry"
      description={
        <>
          Copies the attributes of <span className="font-mono break-all">{request.dn}</span> into a new entry,
          without its operational attributes. Nothing is created until you save.
        </>
      }
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="copy-entry" disabled={busy}>
            Continue
          </Button>
        </>
      }
    >
      <form
        id="copy-entry"
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault()
          void submit()
        }}
      >
        <Field label={source ? `New ${source.attribute}` : 'New name'} htmlFor="copy-value">
          <Input id="copy-value" autoFocus value={value} onChange={(event) => setValue(event.target.value)} />
        </Field>
        <Field label="Parent" htmlFor="copy-parent" hint="The entry the copy is created under.">
          <Input id="copy-parent" mono value={parent} onChange={(event) => setParent(event.target.value)} />
        </Field>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
      </form>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// Rename
// ---------------------------------------------------------------------------

function RenameDialog({ request, onClose }: DialogProps): React.JSX.Element {
  const current = splitRdn(rdnOf(request.dn))
  const [rdn, setRdn] = useState(rdnOf(request.dn))
  const [keepOld, setKeepOld] = useState(false)
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const next = splitRdn(rdn.trim())

  const submit = async () => {
    if (!next) {
      setError('Enter a name in the form attribute=value, for example cn=Jane Doe.')
      return
    }
    setBusy(true)
    const result = await window.api.invoke('entry.rename', {
      connectionId: request.connectionId,
      dn: request.dn,
      newRdn: rdn.trim(),
      deleteOldRdn: !keepOld,
    })
    setBusy(false)
    if (!result.ok) {
      setError(errorText(result.error))
      return
    }
    onClose()
    await afterRelocation(request.connectionId, request.dn, result.value.dn)
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      title="Rename entry"
      description={<span className="font-mono break-all">{request.dn}</span>}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="rename-entry" disabled={busy}>
            Rename
          </Button>
        </>
      }
    >
      <form
        id="rename-entry"
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault()
          void submit()
        }}
      >
        <Field label="New name" htmlFor="rename-rdn" hint="Attribute and value, for example cn=Jane Doe.">
          <Input
            id="rename-rdn"
            mono
            autoFocus
            value={rdn}
            onChange={(event) => setRdn(event.target.value)}
          />
        </Field>
        {current ? (
          <Checkbox
            label={`Keep “${current.value}” as a value of ${current.attribute}`}
            checked={keepOld}
            onChange={(event) => setKeepOld(event.target.checked)}
          />
        ) : null}
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
      </form>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// Move
// ---------------------------------------------------------------------------

function MoveDialog({ request, onClose }: DialogProps): React.JSX.Element {
  const [parent, setParent] = useState(request.newParent ?? parentOf(request.dn))
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const rdn = rdnOf(request.dn)
  const validParent = isValidDn(parent.trim()) && parent.trim() !== ''
  const newDn = validParent ? `${rdn},${parent.trim()}` : undefined

  const submit = async () => {
    if (!newDn) {
      setError('The new parent is not a valid DN.')
      return
    }
    if (isWithin(parent.trim(), request.dn)) {
      setError('An entry cannot be moved below itself.')
      return
    }
    setBusy(true)
    const result = await window.api.invoke('entry.rename', {
      connectionId: request.connectionId,
      dn: request.dn,
      newRdn: rdn,
      deleteOldRdn: true,
      newParent: parent.trim(),
    })
    setBusy(false)
    if (!result.ok) {
      setError(errorText(result.error))
      return
    }
    onClose()
    const tree = useTree.getState()
    const newParentKey = keyOf(parent.trim())
    if (tree.trees[request.connectionId]?.nodes[newParentKey]?.childKeys) {
      tree.refresh(request.connectionId, newParentKey)
    }
    await afterRelocation(request.connectionId, request.dn, result.value.dn)
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      title="Move entry"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="move-entry" disabled={busy}>
            Move
          </Button>
        </>
      }
    >
      <form
        id="move-entry"
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault()
          void submit()
        }}
      >
        <Field label="New parent" htmlFor="move-parent">
          <Input
            id="move-parent"
            mono
            autoFocus
            value={parent}
            onChange={(event) => setParent(event.target.value)}
          />
        </Field>
        <dl className="grid grid-cols-[4rem_1fr] gap-x-3 gap-y-1.5 text-sm" aria-label="DN change">
          <dt className="text-muted-foreground">From</dt>
          <dd className="font-mono text-xs break-all">{request.dn}</dd>
          <dt className="text-muted-foreground">To</dt>
          <dd className="font-mono text-xs break-all">{newDn ?? '—'}</dd>
        </dl>
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
      </form>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// Reload
// ---------------------------------------------------------------------------

/** Reads the entry again from the server; asks first if that would discard pending changes. */
function ReloadDialog({ request, onClose }: DialogProps): React.JSX.Element | null {
  const isOpen = useEditor(
    (store) =>
      store.entry?.connectionId === request.connectionId &&
      store.entry.dn.toLowerCase() === request.dn.toLowerCase(),
  )
  // Read once: the request either reloads right away or waits for confirmation.
  const [pending] = useState(() => (isOpen ? useEditor.getState().pendingChanges().length : 0))

  const reload = () => {
    onClose()
    void useEditor.getState().open(request.connectionId, request.dn)
  }

  // Guards against a second run in development, where React runs effects twice.
  const started = useRef(false)
  useEffect(() => {
    if (pending === 0 && !started.current) {
      started.current = true
      reload()
    }
    // Runs once per request; the dialog is keyed by it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (pending === 0) {
    return null
  }
  return (
    <Dialog
      open
      onOpenChange={(next) => !next && onClose()}
      title="Discard changes and reload?"
      description={`The entry has ${count.format(pending)} unsaved ${pending === 1 ? 'change' : 'changes'}. Reloading reads the entry again from the server and discards them.`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="destructive" autoFocus onClick={reload}>
            Discard and reload
          </Button>
        </>
      }
    >
      <p className="font-mono text-xs break-all text-muted-foreground">{request.dn}</p>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------

type DeleteState =
  | { step: 'counting' }
  | { step: 'confirm'; total: number; incomplete: boolean }
  | { step: 'deleting'; deleted: number; total: number; cancel?: () => void }
  | { step: 'failed'; deleted: number; total: number; failedDn?: string; message: string }
  | { step: 'stopped'; deleted: number; total: number }

function DeleteDialog({ request, onClose }: DialogProps): React.JSX.Element {
  const [state, setState] = useState<DeleteState>({ step: 'counting' })
  const rdn = rdnOf(request.dn)

  useEffect(() => {
    void window.api
      .invoke('entry.countSubtree', { connectionId: request.connectionId, dn: request.dn })
      .then((result) =>
        setState(
          result.ok
            ? { step: 'confirm', total: result.value.count, incomplete: result.value.incomplete }
            : { step: 'failed', deleted: 0, total: 0, message: errorText(result.error) },
        ),
      )
  }, [request])

  const finish = async (deletedAll: boolean) => {
    const tree = useTree.getState()
    const parentKey = keyOf(parentOf(request.dn))
    const editor = useEditor.getState()
    if (editor.entry && isWithin(editor.entry.dn, request.dn)) {
      editor.close()
    }
    if (tree.trees[request.connectionId]?.nodes[parentKey]) {
      tree.refresh(request.connectionId, parentKey)
      if (deletedAll) {
        tree.select(request.connectionId, parentKey)
      }
    }
  }

  const deleteAll = async (total: number) => {
    if (total <= 1) {
      setState({ step: 'deleting', deleted: 0, total: 1 })
      const result = await window.api.invoke('entry.delete', {
        connectionId: request.connectionId,
        dn: request.dn,
      })
      if (!result.ok) {
        setState({
          step: 'failed',
          deleted: 0,
          total: 1,
          failedDn: request.dn,
          message: errorText(result.error),
        })
        return
      }
      await finish(true)
      onClose()
      return
    }
    setState({ step: 'deleting', deleted: 0, total })
    try {
      const started = await window.api.stream(
        'entry.deleteSubtree',
        { connectionId: request.connectionId, dn: request.dn },
        (event) => {
          if (event.kind === 'progress') {
            setState((current) =>
              current.step === 'deleting'
                ? { ...current, deleted: event.data.deleted, total: event.data.total }
                : current,
            )
          } else if (event.kind === 'done') {
            const { deleted, cancelled, failedDn, error } = event.data
            void finish(!cancelled && !error)
            if (error) {
              setState({
                step: 'failed',
                deleted,
                total: event.data.total,
                message: errorText(error),
                ...(failedDn ? { failedDn } : {}),
              })
            } else if (cancelled) {
              setState({ step: 'stopped', deleted, total: event.data.total })
            } else {
              onClose()
            }
          } else if (event.kind === 'error') {
            setState({ step: 'failed', deleted: 0, total, message: event.error.message })
          }
        },
      )
      setState((current) => (current.step === 'deleting' ? { ...current, cancel: started.cancel } : current))
    } catch (error) {
      setState({
        step: 'failed',
        deleted: 0,
        total,
        message: (error as { message?: string }).message ?? 'Delete failed.',
      })
    }
  }

  const description = (() => {
    switch (state.step) {
      case 'counting':
        return 'Counting the entries below it…'
      case 'confirm':
        return state.total <= 1
          ? 'The entry is deleted. This cannot be undone.'
          : `${state.incomplete ? 'At least ' : ''}${count.format(state.total)} entries will be deleted: the entry and everything below it. This cannot be undone.`
      case 'deleting':
        return `Deleting… ${count.format(state.deleted)} of ${count.format(state.total)}`
      case 'stopped':
        return `Stopped after deleting ${count.format(state.deleted)} of ${count.format(state.total)} entries.`
      case 'failed':
        return state.total > 0
          ? `Deleted ${count.format(state.deleted)} of ${count.format(state.total)} entries, then stopped.`
          : 'The entry could not be deleted.'
    }
  })()

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && state.step !== 'deleting' && onClose()}
      title={`Delete ${rdn}?`}
      description={description}
      footer={
        state.step === 'deleting' ? (
          <Button onClick={() => state.cancel?.()} disabled={!state.cancel}>
            Stop
          </Button>
        ) : state.step === 'confirm' ? (
          <>
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="destructive" onClick={() => void deleteAll(state.total)}>
              {state.total <= 1 ? 'Delete' : `Delete ${count.format(state.total)} entries`}
            </Button>
          </>
        ) : (
          <Button onClick={onClose}>{state.step === 'counting' ? 'Cancel' : 'Close'}</Button>
        )
      }
    >
      {state.step === 'deleting' ? (
        <div
          role="progressbar"
          aria-label="Delete progress"
          aria-valuemin={0}
          aria-valuemax={state.total}
          aria-valuenow={state.deleted}
          className="h-1.5 overflow-hidden rounded-full bg-background"
        >
          <div
            className={cn('h-full bg-destructive transition-[width]')}
            style={{ width: `${(state.deleted / Math.max(state.total, 1)) * 100}%` }}
          />
        </div>
      ) : state.step === 'failed' ? (
        <div role="alert" className="flex flex-col gap-1 text-sm">
          {state.failedDn ? (
            <p>
              <span className="font-mono text-xs break-all">{state.failedDn}</span> could not be deleted.
            </p>
          ) : null}
          <p className="text-destructive">{state.message}</p>
        </div>
      ) : (
        <p className="font-mono text-xs break-all text-muted-foreground">{request.dn}</p>
      )}
    </Dialog>
  )
}
