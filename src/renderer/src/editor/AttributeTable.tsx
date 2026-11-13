import { Asterisk, ChevronRight, Download, FolderTree, KeyRound, Lock, Plus, Upload, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Button } from '@renderer/components/ui/button'
import { Combobox } from '@renderer/components/ui/combobox'
import { CopyButton } from '@renderer/components/CopyButton'
import { cn } from '@renderer/lib/utils'
import type { AttributeValue } from '@shared/entry'
import { describePassword, isPasswordAttribute } from '@shared/password'
import type { SchemaModel } from '@shared/schema-model'
import {
  addableAttributes,
  addAttribute,
  addValue,
  isChanged,
  isNewValue,
  removeValue,
  orderAttributes,
  setValue,
  type Working,
} from './model'
import { BinaryValue } from './BinaryValue'
import { DnPickerDialog } from './DnPickerDialog'
import { PasswordDialog } from './PasswordDialog'
import { suggestedFileName } from './file-names'
import { isMultiline, lineBreakStyle, lineCount, MAX_VISIBLE_LINES, withLineBreaks } from './multiline'

/** Attributes with more values than this start collapsed to a value count. */
const COLLAPSE_ABOVE = 10
const count = new Intl.NumberFormat()

const actionButton =
  'flex size-7 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:bg-hover hover:text-foreground'

/** Asks main to show a file dialog and read the chosen file; undefined if cancelled. */
async function chooseFile(): Promise<Uint8Array<ArrayBuffer> | undefined> {
  const result = await window.api.invoke('binary.readFromFile', {})
  return result.ok && result.value ? result.value : undefined
}

/** The entry's attributes, one row per value (entry-editing spec: view and edit attribute values). */
export function AttributeTable({
  connectionId,
  original,
  working,
  schema,
  readOnly,
  problems,
  onChange,
}: {
  /** The entry's connection, for choosing DN values from its directory. */
  connectionId: string
  original: Working
  working: Working
  schema: SchemaModel
  readOnly: boolean
  problems: Map<string, string>
  onChange: (working: Working) => void
}): React.JSX.Element {
  const [focusTarget, setFocusTarget] = useState<string>()
  const [picking, setPicking] = useState<{ attribute: string; index: number; value: string }>()
  // The password value being set: an existing one by index, or a new one without.
  const [settingPassword, setSettingPassword] = useState<{ attribute: string; index?: number }>()
  // Collapse state the user chose, by lowercased attribute name; otherwise the default applies.
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const isCollapsed = (name: string, values: number) =>
    values > COLLAPSE_ABOVE && !(expanded[name.toLowerCase()] ?? false)
  const setCollapsed = (name: string, collapsed: boolean) =>
    setExpanded((current) => ({ ...current, [name.toLowerCase()]: !collapsed }))
  // File dialogs are asynchronous: apply their result to the latest working copy, not the one
  // from the render that opened the dialog.
  const workingRef = useRef(working)
  useEffect(() => {
    workingRef.current = working
  })
  const latest = () => workingRef.current
  const isBinary = (name: string) =>
    schema.isBinary(name) ||
    working.some(
      (attribute) =>
        attribute.name.toLowerCase() === name.toLowerCase() &&
        attribute.values.some((value) => typeof value !== 'string'),
    )
  const problemFor = (name: string) =>
    [...problems].find(([attribute]) => attribute.toLowerCase() === name.toLowerCase())?.[1]

  return (
    <div className="flex flex-col" role="table" aria-label="Attributes">
      {orderAttributes(working, schema).map(({ attribute, group }) => {
        const operational = group === 'operational'
        const locked = readOnly || !schema.isUserModifiable(attribute.name)
        const singleValued = schema.isSingleValued(attribute.name)
        const dnValued = schema.isDistinguishedName(attribute.name)
        const changed = isChanged(original, working, attribute.name)
        const problem = problemFor(attribute.name)
        // objectClass is required by every entry (MUST of `top`).
        const isRequired = group === 'required' || group === 'objectClass'
        // A lost connection makes the whole entry read-only; a banner says so, not every row.
        const lockedBySchema = locked && !readOnly
        const collapsible = attribute.values.length > COLLAPSE_ABOVE
        const collapsed = isCollapsed(attribute.name, attribute.values.length)
        return (
          <div
            key={attribute.name}
            role="rowgroup"
            aria-label={attribute.name}
            className="group/attribute grid grid-cols-[minmax(8rem,14rem)_1fr] gap-x-4 border-b border-border/70 py-1 pr-5 pl-7 last:border-b-0"
          >
            <div className="flex min-w-0 flex-col pt-1.5">
              <span
                className={cn(
                  'flex items-center gap-1.5 text-sm',
                  group === 'objectClass' || group === 'required'
                    ? 'font-semibold text-foreground'
                    : operational
                      ? 'text-muted-foreground'
                      : 'text-foreground',
                )}
              >
                {/* In the row's wider left padding, so the names stay in one column. */}
                <span className="-ml-[18px] flex w-3 shrink-0 justify-center text-subtle-foreground">
                  {lockedBySchema ? (
                    <Lock className="size-3" role="img" aria-label="Read-only" strokeWidth={2.25}>
                      <title>{operational ? 'Read-only: maintained by the server' : 'Read-only'}</title>
                    </Lock>
                  ) : isRequired ? (
                    <Asterisk className="size-3" role="img" aria-label="Required" strokeWidth={2.5}>
                      <title>Required by the entry's object classes</title>
                    </Asterisk>
                  ) : null}
                </span>
                <span className="truncate" title={attribute.name}>
                  {attribute.name}
                </span>
                {collapsible ? (
                  <button
                    type="button"
                    className="-my-1 flex size-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:bg-hover hover:text-foreground"
                    aria-expanded={!collapsed}
                    aria-label={`${collapsed ? 'Expand' : 'Collapse'} ${attribute.name} values`}
                    title={collapsed ? 'Show values' : 'Hide values'}
                    onClick={() => setCollapsed(attribute.name, !collapsed)}
                  >
                    <ChevronRight
                      className={cn('size-3.5 transition-transform', !collapsed && 'rotate-90')}
                    />
                  </button>
                ) : null}
                {changed ? (
                  <span
                    className="size-1.5 shrink-0 rounded-full bg-primary"
                    role="img"
                    aria-label="Changed"
                  />
                ) : null}
                {/* On the name line, so the hidden actions take no extra height. */}
                <span className="-my-1 ml-auto flex shrink-0 opacity-0 transition-opacity group-hover/attribute:opacity-100 group-focus-within/attribute:opacity-100 has-data-copied:opacity-100">
                  {!locked && !singleValued ? (
                    <button
                      type="button"
                      className={cn(actionButton, 'size-6')}
                      aria-label={`Add ${attribute.name} value`}
                      title="Add value"
                      onClick={async () => {
                        setCollapsed(attribute.name, false)
                        if (isPasswordAttribute(attribute.name)) {
                          setSettingPassword({ attribute: attribute.name })
                          return
                        }
                        if (isBinary(attribute.name)) {
                          const bytes = await chooseFile()
                          if (bytes) {
                            onChange(addValue(latest(), attribute.name, bytes))
                          }
                          return
                        }
                        setFocusTarget(`${attribute.name}-${attribute.values.length}`)
                        onChange(addValue(working, attribute.name))
                      }}
                    >
                      <Plus className="size-3.5" />
                    </button>
                  ) : null}
                  {attribute.values.length > 1 &&
                  attribute.values.every((value) => typeof value === 'string') ? (
                    <CopyButton
                      label={`Copy all ${attribute.name} values`}
                      className="size-6"
                      text={() => attribute.values.join('\n')}
                    />
                  ) : null}
                </span>
              </span>
            </div>
            <div className="flex min-w-0 flex-col">
              {collapsed ? (
                <div role="row" className="py-0.5">
                  <div role="cell">
                    <button
                      type="button"
                      className="flex h-7 items-center rounded-sm px-2.5 text-sm text-muted-foreground hover:bg-hover hover:text-foreground"
                      onClick={() => setCollapsed(attribute.name, false)}
                    >
                      {count.format(attribute.values.length)} values
                    </button>
                  </div>
                </div>
              ) : null}
              {(collapsed ? [] : attribute.values).map((value, index) => {
                const fresh = isNewValue(original, attribute.name, value)
                const inputId = `${attribute.name}-${index}`
                return (
                  <div key={index} role="row" className="group/value relative flex items-center gap-1 py-0.5">
                    {fresh && !locked ? (
                      <span
                        className="absolute top-1.5 bottom-1.5 -left-2.5 w-0.5 rounded-full bg-primary"
                        aria-hidden
                      />
                    ) : null}
                    <ValueField
                      id={inputId}
                      name={attribute.name}
                      value={value}
                      locked={locked}
                      muted={operational}
                      autoFocus={focusTarget === inputId}
                      onChange={(next) => onChange(setValue(working, attribute.name, index, next))}
                    />
                    <div className="flex shrink-0 opacity-0 transition-opacity group-hover/value:opacity-100 group-focus-within/value:opacity-100 has-data-copied:opacity-100">
                      {typeof value === 'string' && dnValued && !locked ? (
                        <button
                          type="button"
                          className={actionButton}
                          aria-label={`Choose ${attribute.name} value from the directory`}
                          title="Choose entry…"
                          onClick={() => setPicking({ attribute: attribute.name, index, value })}
                        >
                          <FolderTree className="size-3.5" />
                        </button>
                      ) : null}
                      {isPasswordAttribute(attribute.name) ? (
                        !locked ? (
                          <button
                            type="button"
                            className={actionButton}
                            aria-label={`Set ${attribute.name} value`}
                            title="Set password…"
                            onClick={() => setSettingPassword({ attribute: attribute.name, index })}
                          >
                            <KeyRound className="size-3.5" />
                          </button>
                        ) : null
                      ) : typeof value === 'string' ? (
                        <CopyButton label={`Copy ${attribute.name} value`} className="size-7" text={value} />
                      ) : (
                        <>
                          <button
                            type="button"
                            className={actionButton}
                            aria-label={`Save ${attribute.name} value to a file`}
                            title="Save to file…"
                            onClick={() =>
                              void window.api.invoke('binary.saveToFile', {
                                bytes: value,
                                suggestedName: suggestedFileName(attribute.name, value),
                              })
                            }
                          >
                            <Download className="size-3.5" />
                          </button>
                          {!locked ? (
                            <button
                              type="button"
                              className={actionButton}
                              aria-label={`Replace ${attribute.name} value from a file`}
                              title="Replace from file…"
                              onClick={async () => {
                                const bytes = await chooseFile()
                                if (bytes) {
                                  onChange(setValue(latest(), attribute.name, index, bytes))
                                }
                              }}
                            >
                              <Upload className="size-3.5" />
                            </button>
                          ) : null}
                        </>
                      )}
                      {!locked ? (
                        <button
                          type="button"
                          className={actionButton}
                          aria-label={`Remove ${attribute.name} value`}
                          title="Remove value"
                          onClick={() => onChange(removeValue(working, attribute.name, index))}
                        >
                          <X className="size-3.5" />
                        </button>
                      ) : null}
                    </div>
                  </div>
                )
              })}
              {problem ? (
                <p role="alert" className="pb-1 text-xs text-destructive">
                  {problem}
                </p>
              ) : null}
            </div>
          </div>
        )
      })}
      {[...problems]
        .filter(([name]) => !working.some((attribute) => attribute.name.toLowerCase() === name.toLowerCase()))
        .map(([name, message]) => (
          // A required attribute that was removed has no row of its own to show its problem.
          <div
            key={name}
            role="alert"
            className="flex items-center gap-3 border-b border-border/70 py-2 pr-5 pl-7 text-sm text-destructive"
          >
            <span className="min-w-0 flex-1">{message}</span>
            {!readOnly ? (
              <button
                type="button"
                className="h-7 shrink-0 rounded-sm px-2 text-sm font-medium text-foreground hover:bg-hover"
                onClick={() => {
                  setFocusTarget(`${name}-0`)
                  onChange(addAttribute(working, name))
                }}
              >
                Add {name}
              </button>
            ) : null}
          </div>
        ))}
      {!readOnly ? (
        <AddAttribute
          options={addableAttributes(working, schema)}
          onAdd={async (name) => {
            const existing = working.find((attribute) => attribute.name.toLowerCase() === name.toLowerCase())
            if (existing) {
              setCollapsed(existing.name, false)
            }
            if (isPasswordAttribute(name)) {
              setSettingPassword({ attribute: existing?.name ?? name })
              return
            }
            if (isBinary(name)) {
              // Binary attributes get their value from a file.
              const bytes = await chooseFile()
              if (bytes) {
                const current = latest()
                const present = current.find(
                  (attribute) => attribute.name.toLowerCase() === name.toLowerCase(),
                )
                onChange(
                  present ? addValue(current, present.name, bytes) : [...current, { name, values: [bytes] }],
                )
              }
              return
            }
            setFocusTarget(`${existing?.name ?? name}-${existing ? existing.values.length : 0}`)
            onChange(addAttribute(working, existing?.name ?? name))
          }}
        />
      ) : null}
      {settingPassword ? (
        <PasswordDialog
          onCancel={() => setSettingPassword(undefined)}
          onSet={(text) => {
            const { attribute: name, index } = settingPassword
            // Stored as bytes where the schema says the attribute is binary (Octet String).
            const value = isBinary(name) ? new TextEncoder().encode(text) : text
            const current = latest()
            const present = current.find((attribute) => attribute.name.toLowerCase() === name.toLowerCase())
            onChange(
              index !== undefined
                ? setValue(current, name, index, value)
                : present
                  ? addValue(current, present.name, value)
                  : [...current, { name, values: [value] }],
            )
            setSettingPassword(undefined)
          }}
        />
      ) : null}
      {picking ? (
        <DnPickerDialog
          connectionId={connectionId}
          attribute={picking.attribute}
          initialDn={picking.value}
          onCancel={() => setPicking(undefined)}
          onChoose={(dn) => {
            onChange(setValue(latest(), picking.attribute, picking.index, dn))
            setPicking(undefined)
          }}
        />
      ) : null}
    </div>
  )
}

function ValueField({
  id,
  name,
  value,
  locked,
  muted,
  autoFocus,
  onChange,
}: {
  id: string
  name: string
  value: AttributeValue
  locked: boolean
  /** Operational attributes: shown, but quieter than the entry's own data. */
  muted: boolean
  autoFocus: boolean
  onChange: (value: string) => void
}): React.JSX.Element {
  if (isPasswordAttribute(name)) {
    // Never shown, even hashed: only how it is stored.
    return (
      <span className="flex min-h-7 min-w-0 flex-1 items-center px-2.5 text-sm text-muted-foreground">
        {describePassword(value)} password
      </span>
    )
  }
  if (typeof value !== 'string') {
    return <BinaryValue attribute={name} bytes={value} />
  }
  if (locked) {
    return (
      <span
        className={cn(
          'selectable flex min-h-7 min-w-0 flex-1 items-center px-2.5 font-mono text-sm',
          isMultiline(value) ? 'py-1 break-words whitespace-pre-wrap' : 'break-all',
          muted && 'text-muted-foreground',
        )}
      >
        {value}
      </span>
    )
  }
  return (
    <TextField id={id} name={name} value={value} muted={muted} autoFocus={autoFocus} onChange={onChange} />
  )
}

const textFieldClasses = cn(
  'min-w-0 flex-1 rounded-sm border border-transparent bg-transparent px-2.5 font-mono text-sm',
  'hover:border-input focus-visible:border-primary focus-visible:bg-surface focus-visible:outline-none',
)

/**
 * An editable text value: an input, or a text area for multi-line values (entry-editing spec:
 * multi-line text values, line breaks are preserved).
 */
function TextField({
  id,
  name,
  value,
  muted,
  autoFocus,
  onChange,
}: {
  id: string
  name: string
  value: string
  muted: boolean
  autoFocus: boolean
  onChange: (value: string) => void
}): React.JSX.Element {
  // Once multi-line, stays a text area: switching to an input when the last line break is
  // deleted would mount a new element and lose the focus and the cursor mid-edit.
  const [multiline, setMultiline] = useState(() => isMultiline(value))
  if (!multiline && isMultiline(value)) {
    setMultiline(true)
  }
  // A text area hands back LF only; CR LF values get theirs back, so only edited lines change.
  const [style] = useState(() => lineBreakStyle(value))
  if (!multiline) {
    return (
      <input
        id={id}
        aria-label={`${name} value`}
        value={value}
        autoFocus={autoFocus}
        spellCheck={false}
        onChange={(event) => onChange(event.target.value)}
        className={cn(textFieldClasses, 'h-7', muted && 'text-muted-foreground')}
      />
    )
  }
  return (
    <textarea
      id={id}
      aria-label={`${name} value`}
      value={value}
      rows={Math.min(lineCount(value), MAX_VISIBLE_LINES)}
      autoFocus={autoFocus}
      spellCheck={false}
      onChange={(event) => onChange(withLineBreaks(event.target.value, style))}
      className={cn(
        textFieldClasses,
        'min-h-7 resize-y overflow-y-auto py-1 leading-5',
        muted && 'text-muted-foreground',
      )}
    />
  )
}

function AddAttribute({
  options,
  onAdd,
}: {
  options: string[]
  onAdd: (name: string) => void
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  if (!open) {
    return (
      <div className="px-5 py-2.5">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex h-7 items-center gap-1.5 rounded-sm px-2 text-sm text-muted-foreground hover:bg-hover hover:text-foreground"
        >
          <Plus className="size-3.5" /> Add attribute
        </button>
      </div>
    )
  }
  const close = () => {
    setName('')
    setOpen(false)
  }
  const submit = (text: string) => {
    const match = options.find((option) => option.toLowerCase() === text.trim().toLowerCase())
    if (text.trim() !== '') {
      onAdd(match ?? text.trim())
    }
    close()
  }
  return (
    <form
      className="flex items-center gap-2 px-5 py-2.5"
      onSubmit={(event) => {
        event.preventDefault()
        submit(name)
      }}
      // Opened by accident: clicking anywhere else closes it again while nothing is typed.
      onBlur={(event) => {
        if (name.trim() === '' && !event.currentTarget.contains(event.relatedTarget as Node | null)) {
          close()
        }
      }}
    >
      <Combobox
        label="Attribute to add"
        autoFocus
        value={name}
        options={options}
        placeholder="Attribute name"
        className="w-64"
        onChange={setName}
        onSubmit={submit}
        onCancel={close}
      />
      <Button type="submit" disabled={name.trim() === ''}>
        Add
      </Button>
      <Button variant="ghost" className="text-muted-foreground" onClick={close}>
        Cancel
      </Button>
    </form>
  )
}
