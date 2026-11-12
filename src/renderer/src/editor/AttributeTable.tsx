import { Copy, Download, Plus, Upload, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Button } from '@renderer/components/ui/button'
import { Combobox } from '@renderer/components/ui/combobox'
import { cn } from '@renderer/lib/utils'
import type { AttributeValue } from '@shared/entry'
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
import { suggestedFileName } from './file-names'

const actionButton =
  'flex size-7 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:bg-hover hover:text-foreground'

function copy(text: string): void {
  void window.api.invoke('clipboard.writeText', { text })
}

/** Asks main to show a file dialog and read the chosen file; undefined if cancelled. */
async function chooseFile(): Promise<Uint8Array<ArrayBuffer> | undefined> {
  const result = await window.api.invoke('binary.readFromFile', {})
  return result.ok && result.value ? result.value : undefined
}

/** The entry's attributes, one row per value (entry-editing spec: view and edit attribute values). */
export function AttributeTable({
  original,
  working,
  schema,
  readOnly,
  problems,
  onChange,
}: {
  original: Working
  working: Working
  schema: SchemaModel
  readOnly: boolean
  problems: Map<string, string>
  onChange: (working: Working) => void
}): React.JSX.Element {
  const [focusTarget, setFocusTarget] = useState<string>()
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
        const changed = isChanged(original, working, attribute.name)
        const problem = problemFor(attribute.name)
        // objectClass is required by every entry (MUST of `top`).
        const isRequired = group === 'required' || group === 'objectClass'
        return (
          <div
            key={attribute.name}
            role="rowgroup"
            aria-label={attribute.name}
            className="group/attribute grid grid-cols-[minmax(8rem,14rem)_1fr] gap-x-4 border-b border-border/70 px-5 py-1 last:border-b-0"
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
                <span className="truncate" title={attribute.name}>
                  {attribute.name}
                </span>
                {changed ? (
                  <span
                    className="size-1.5 shrink-0 rounded-full bg-primary"
                    role="img"
                    aria-label="Changed"
                  />
                ) : null}
                {/* On the name line, so the hidden actions take no extra height. */}
                <span className="-my-1 ml-auto flex shrink-0 opacity-0 transition-opacity group-hover/attribute:opacity-100 group-focus-within/attribute:opacity-100">
                  {!locked && !singleValued ? (
                    <button
                      type="button"
                      className={cn(actionButton, 'size-6')}
                      aria-label={`Add ${attribute.name} value`}
                      title="Add value"
                      onClick={async () => {
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
                    <button
                      type="button"
                      className={cn(actionButton, 'size-6')}
                      aria-label={`Copy all ${attribute.name} values`}
                      title="Copy all values"
                      onClick={() => copy(attribute.values.join('\n'))}
                    >
                      <Copy className="size-3.5" />
                    </button>
                  ) : null}
                </span>
              </span>
              {isRequired ? <span className="text-xs text-subtle-foreground">required</span> : null}
              {locked && !readOnly ? <span className="text-xs text-subtle-foreground">read-only</span> : null}
            </div>
            <div className="flex min-w-0 flex-col">
              {attribute.values.map((value, index) => {
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
                    <div className="flex shrink-0 opacity-0 transition-opacity group-hover/value:opacity-100 group-focus-within/value:opacity-100">
                      {typeof value === 'string' ? (
                        <button
                          type="button"
                          className={actionButton}
                          aria-label={`Copy ${attribute.name} value`}
                          title="Copy value"
                          onClick={() => copy(value)}
                        >
                          <Copy className="size-3.5" />
                        </button>
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
            className="flex items-center gap-3 border-b border-border/70 px-5 py-2 text-sm text-destructive"
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
  if (typeof value !== 'string') {
    return <BinaryValue attribute={name} bytes={value} />
  }
  if (locked) {
    return (
      <span
        className={cn(
          'selectable flex min-h-7 min-w-0 flex-1 items-center px-2.5 font-mono text-sm break-all',
          muted && 'text-muted-foreground',
        )}
      >
        {value}
      </span>
    )
  }
  return (
    <input
      id={id}
      aria-label={`${name} value`}
      value={value}
      autoFocus={autoFocus}
      spellCheck={false}
      onChange={(event) => onChange(event.target.value)}
      className={cn(
        'h-7 min-w-0 flex-1 rounded-sm border border-transparent bg-transparent px-2.5 font-mono text-sm',
        muted && 'text-muted-foreground',
        'hover:border-input focus-visible:border-primary focus-visible:bg-surface focus-visible:outline-none',
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
