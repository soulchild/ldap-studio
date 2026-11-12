import { useVirtualizer } from '@tanstack/react-virtual'
import { ListFilter, X } from 'lucide-react'
import { useMemo, useRef } from 'react'
import { Checkbox } from '@renderer/components/ui/checkbox'
import { Combobox } from '@renderer/components/ui/combobox'
import { cn } from '@renderer/lib/utils'
import { NO_SCHEMA, useSchema } from '@renderer/state/schema'
import { useTree } from '@renderer/state/tree'
import { DEFAULT_FORM, MAX_MATCHES, useTreeFilter } from '@renderer/state/tree-filter'
import { parseDn, serializeRdn } from '@shared/dn'
import { entryKind } from './entry-kind'
import { EntryIcon } from './EntryIcon'
import { keyOf, type Tree } from './model'
import { buildFilter, filterRows, needsValue, OPERATORS, type FilterOperator } from './quick-filter'

const count = new Intl.NumberFormat()
const ROW_HEIGHT = 28
const INDENT = 16
const field =
  'h-7 min-w-0 rounded-sm border border-input bg-surface px-2 text-xs text-foreground placeholder:text-subtle-foreground focus-visible:border-primary focus-visible:outline-none'

/** A tree root by its full DN, as in the tree; any other entry by its RDN. */
function entryLabel(dn: string, tree: Tree | undefined): string {
  if (tree?.rootKeys.includes(keyOf(dn))) {
    return dn
  }
  const parsed = parseDn(dn)
  return parsed.ok && parsed.dn[0] ? serializeRdn(parsed.dn[0]) : dn
}

/** The entry the filter searches below: the selected one, or the first root. */
function baseOf(connectionId: string, tree: Tree): string | undefined {
  const selected = useTree.getState().selected[connectionId]
  const node = (selected ? tree.nodes[selected] : undefined) ?? tree.nodes[tree.rootKeys[0] ?? '']
  return node?.dn
}

/**
 * The filter at the top of the directory pane (directory-tree spec: filter the tree): an
 * attribute, an operator and a value, searched on the server below the selected entry.
 */
export function TreeFilterBar({
  connectionId,
  tree,
}: {
  connectionId: string
  tree: Tree
}): React.JSX.Element {
  const form = useTreeFilter((store) => store.forms[connectionId]) ?? DEFAULT_FORM
  const applied = useTreeFilter((store) => store.applied[connectionId])
  const { setForm, apply, clear } = useTreeFilter.getState()
  const schema = useSchema((store) => store.schemas[connectionId]) ?? NO_SCHEMA
  const attributes = useMemo(
    () => [...new Set(schema.model.attributeNames())].sort((a, b) => a.localeCompare(b)),
    [schema.model],
  )
  const valueField = useRef<HTMLInputElement>(null)
  const filter = buildFilter(form, schema.model)
  const run = () => {
    const base = baseOf(connectionId, tree)
    if (filter && base) {
      void apply(connectionId, base, filter)
    }
  }

  return (
    <form
      aria-label="Filter the tree"
      className="flex shrink-0 flex-col gap-1.5 border-b px-3 pb-2.5"
      onSubmit={(event) => {
        event.preventDefault()
        run()
      }}
    >
      <div className="flex gap-1.5">
        <Combobox
          label="Filter attribute"
          value={form.attribute}
          options={attributes}
          placeholder="Attribute: name"
          className={cn(field, 'flex-1')}
          onChange={(attribute) => setForm(connectionId, { attribute })}
          onSubmit={() => valueField.current?.focus()}
          onCancel={() => undefined}
        />
        <select
          aria-label="Filter operator"
          value={form.operator}
          onChange={(event) => setForm(connectionId, { operator: event.target.value as FilterOperator })}
          className={cn(field, 'w-28 shrink-0 pr-7 pl-2')}
        >
          {OPERATORS.map((operator) => (
            <option key={operator.value} value={operator.value}>
              {operator.label}
            </option>
          ))}
        </select>
      </div>
      <div className="flex gap-1.5">
        <input
          ref={valueField}
          aria-label="Filter value"
          value={needsValue(form.operator) ? form.value : ''}
          disabled={!needsValue(form.operator)}
          placeholder={needsValue(form.operator) ? 'Value' : 'No value needed'}
          spellCheck={false}
          onChange={(event) => setForm(connectionId, { value: event.target.value })}
          onKeyDown={(event) => {
            if (event.key === 'Escape' && applied) {
              clear(connectionId)
            }
          }}
          className={cn(field, 'flex-1 font-mono disabled:opacity-60')}
        />
        <button
          type="submit"
          disabled={!filter}
          className="flex h-7 shrink-0 items-center gap-1 rounded-sm border border-input bg-surface px-2 text-xs font-medium hover:bg-hover disabled:pointer-events-none disabled:opacity-50"
        >
          <ListFilter className="size-3.5" /> Filter
        </button>
      </div>
      <Checkbox
        className="text-xs text-muted-foreground"
        label="Whole subtree"
        checked={form.subtree}
        onChange={(event) => setForm(connectionId, { subtree: event.target.checked })}
      />
    </form>
  )
}

/** What the filter found, or that it is still searching. */
export function TreeFilterStatus({ connectionId }: { connectionId: string }): React.JSX.Element | null {
  const applied = useTreeFilter((store) => store.applied[connectionId])
  const tree = useTree((store) => store.trees[connectionId])
  if (!applied) {
    return null
  }
  const found = count.format(applied.matches.length)
  const where = `${applied.subtree ? 'below' : 'directly below'} ${entryLabel(applied.base, tree)}`
  const text =
    applied.status === 'running'
      ? `Searching ${where}… ${found}`
      : applied.status === 'error'
        ? (applied.error ?? 'The filter failed.')
        : applied.matches.length === 0
          ? `No entries match ${where}.`
          : applied.sizeLimitReached
            ? `Showing the first ${count.format(MAX_MATCHES)} matches ${where}. Narrow the filter to see the rest.`
            : `${found} ${applied.matches.length === 1 ? 'match' : 'matches'} ${where}${applied.status === 'stopped' || applied.incomplete ? ' (incomplete)' : ''}.`
  return (
    <div
      className={cn(
        'flex shrink-0 items-start gap-2 border-b px-3.5 py-1.5 text-xs',
        applied.status === 'error'
          ? 'text-destructive'
          : applied.sizeLimitReached
            ? 'text-warning'
            : 'text-muted-foreground',
      )}
    >
      <p
        role={applied.status === 'error' ? 'alert' : 'status'}
        className="min-w-0 flex-1 py-0.5"
        title={applied.base}
      >
        {text}
      </p>
      <button
        type="button"
        onClick={() => useTreeFilter.getState().clear(connectionId)}
        className="-my-0.5 flex h-6 shrink-0 items-center gap-1 rounded-sm px-1.5 font-medium text-foreground hover:bg-hover"
      >
        <X className="size-3.5" /> Clear filter
      </button>
    </div>
  )
}

/** The matches with the entries leading to them; selecting one opens it as in the tree. */
export function FilteredTree({
  connectionId,
  tree,
}: {
  connectionId: string
  tree: Tree
}): React.JSX.Element {
  const applied = useTreeFilter((store) => store.applied[connectionId])
  const selected = useTree((store) => store.selected[connectionId])
  const rootDns = useMemo(() => tree.rootKeys.map((key) => tree.nodes[key]?.dn ?? key), [tree])
  const rows = useMemo(() => filterRows(applied?.matches ?? [], rootDns), [applied?.matches, rootDns])
  const scroller = useRef<HTMLDivElement>(null)
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scroller.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
  })
  const selectedIndex = rows.findIndex((row) => row.key === selected)
  const open = (index: number) => {
    const row = rows[index]
    if (row) {
      void useTree.getState().reveal(connectionId, row.dn)
      virtualizer.scrollToIndex(index, { align: 'auto' })
    }
  }

  return (
    <div
      ref={scroller}
      role="tree"
      aria-label="Filtered directory tree"
      tabIndex={0}
      aria-activedescendant={selectedIndex >= 0 ? `filtered-${selectedIndex}` : undefined}
      onKeyDown={(event) => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault()
          const next = selectedIndex + (event.key === 'ArrowDown' ? 1 : -1)
          open(Math.min(Math.max(next, 0), rows.length - 1))
        }
      }}
      className="h-full overflow-y-auto outline-none"
    >
      <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
        {virtualizer.getVirtualItems().map((item) => {
          const row = rows[item.index]
          if (!row) {
            return null
          }
          const isSelected = row.key === selected
          return (
            <div
              key={row.key}
              className="absolute inset-x-0 px-2"
              style={{ height: ROW_HEIGHT, transform: `translateY(${item.start}px)` }}
            >
              <div
                id={`filtered-${item.index}`}
                role="treeitem"
                aria-level={row.depth + 1}
                aria-selected={isSelected}
                aria-label={row.label}
                data-match={row.match}
                onClick={() => open(item.index)}
                className={cn(
                  'flex h-full items-center gap-1 rounded-sm pr-2 text-sm',
                  isSelected ? 'bg-selection-strong' : 'hover:bg-hover',
                  !row.match && 'text-muted-foreground',
                )}
                // Same columns as the tree: the chevron's place (20) stays empty.
                style={{ paddingLeft: 8 + row.depth * INDENT + 24 }}
              >
                <EntryIcon
                  kind={entryKind(row.objectClasses, row.label)}
                  className={isSelected ? 'text-primary' : 'text-subtle-foreground'}
                />
                <span className={cn('min-w-0 flex-1 truncate', row.match && 'font-medium')}>{row.label}</span>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
