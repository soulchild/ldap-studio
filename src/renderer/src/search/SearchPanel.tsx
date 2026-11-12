import { useVirtualizer } from '@tanstack/react-virtual'
import { ArrowDown, ArrowUp, Crosshair, History } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { EmptyState } from '@renderer/components/EmptyState'
import { Button } from '@renderer/components/ui/button'
import { ContextMenu } from '@renderer/components/ui/context-menu'
import { DropdownMenu } from '@renderer/components/ui/dropdown-menu'
import { cn } from '@renderer/lib/utils'
import { useConnections } from '@renderer/state/connections'
import { useEditor } from '@renderer/state/editor'
import { NO_SCHEMA, useSchema } from '@renderer/state/schema'
import { DEFAULT_SIZE_LIMIT, useSearch, type SearchParams } from '@renderer/state/search'
import { useTree } from '@renderer/state/tree'
import { EntryIcon } from '@renderer/tree/EntryIcon'
import { entryKind, type EntryKind } from '@renderer/tree/entry-kind'
import { keyOf } from '@renderer/tree/model'
import { describeBinary } from '@shared/binary'
import { isDescendantOf, parseDn } from '@shared/dn'
import type { SearchEntry, SearchScope } from '@shared/ipc'
import { attributeListSuggestions, filterDiagnostics, filterSuggestions } from './assist'
import { CodeField } from './CodeField'

const ROW_HEIGHT = 28
const count = new Intl.NumberFormat()
const SCOPES: { value: SearchScope; label: string }[] = [
  { value: 'base', label: 'Base entry' },
  { value: 'one', label: 'One level' },
  { value: 'sub', label: 'Subtree' },
]

/**
 * The active connection's profile and connection id. Each selector returns a string: a selector
 * returning a new object every time would make React re-render endlessly.
 */
function useActiveConnection(): { profileId: string; connectionId: string } | undefined {
  const profileId = useConnections((store) => store.activeProfileId)
  const connectionId = useConnections((store) => {
    const state = store.activeProfileId ? store.states[store.activeProfileId] : undefined
    return state?.status === 'connected' ? state.connectionId : undefined
  })
  return useMemo(
    () => (profileId && connectionId ? { profileId, connectionId } : undefined),
    [profileId, connectionId],
  )
}

/** Search form and results (directory-search spec). */
export function SearchPanel(): React.JSX.Element {
  const active = useActiveConnection()
  const search = useSearch()
  const schema = useSchema((store) => (active ? store.schemas[active.connectionId] : undefined)) ?? NO_SCHEMA
  const diagnostics = useMemo(
    () => filterDiagnostics(search.params.filter, schema.model, schema.available),
    [search.params.filter, schema],
  )
  const syntaxError = diagnostics.find((item) => item.severity === 'error')
  const warnings = diagnostics.filter((item) => item.severity === 'warning')
  const canSearch = active !== undefined && search.params.filter.trim() !== '' && !syntaxError
  const running = search.status.state === 'running'

  // While picking, the next tree selection becomes the base DN.
  useEffect(() => {
    if (!search.picking || !active) {
      return
    }
    const before = useTree.getState().selected[active.connectionId]
    return useTree.subscribe((store) => {
      const key = store.selected[active.connectionId]
      if (key && key !== before) {
        const dn = store.trees[active.connectionId]?.nodes[key]?.dn
        if (dn) {
          useSearch.getState().setParams({ base: dn })
        }
        useSearch.getState().setPicking(false)
      }
    })
  }, [search.picking, active])

  const run = () => {
    if (canSearch && active) {
      void search.run(active.connectionId)
    }
  }

  // A search needs a server; until then the form has nothing to work with.
  if (!active) {
    return <EmptyState>Connect to a server to search its directory.</EmptyState>
  }

  return (
    <div className="flex h-full flex-col">
      <form
        className="flex shrink-0 flex-col gap-2 border-b px-3.5 py-2.5"
        aria-label="Search"
        onSubmit={(event) => {
          event.preventDefault()
          run()
        }}
      >
        <div className="flex items-start gap-2">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <CodeField
              id="search-filter"
              label="Filter"
              value={search.params.filter}
              placeholder="Filter, for example (&(objectClass=person)(mail=*))"
              invalid={syntaxError !== undefined}
              onChange={(filter) => search.setParams({ filter })}
              onSubmit={run}
              suggest={(input, cursor) => filterSuggestions(input, cursor, schema.model)}
              diagnose={() => diagnostics}
            />
            {syntaxError ? (
              <p role="alert" className="text-xs text-destructive">
                {syntaxError.message}
              </p>
            ) : warnings.length > 0 ? (
              <p role="status" className="text-xs text-warning">
                {warnings.map((warning) => warning.message).join(' ')}
              </p>
            ) : null}
          </div>
          <div className="flex w-64 shrink-0 items-start gap-2">
            <CodeField
              id="search-attributes"
              label="Attributes to return"
              value={search.params.attributes}
              placeholder="Attributes: all"
              onChange={(attributes) => search.setParams({ attributes })}
              onSubmit={run}
              suggest={(input, cursor) => attributeListSuggestions(input, cursor, schema.model)}
            />
          </div>
          {/* Separate keys: reusing one element would turn the clicked Stop button into the
              submit button before the click's default action, restarting the search. */}
          {running ? (
            <Button key="stop" type="button" onClick={search.stop}>
              Stop
            </Button>
          ) : (
            <Button key="search" variant="primary" type="submit" disabled={!canSearch}>
              Search
            </Button>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
          <label className="flex min-w-80 flex-1 items-center gap-2">
            Base
            <input
              aria-label="Base DN"
              value={search.params.base}
              spellCheck={false}
              onChange={(event) => search.setParams({ base: event.target.value })}
              className="h-7 min-w-0 flex-1 rounded-sm border border-input bg-surface px-2 font-mono text-xs text-foreground focus-visible:border-primary focus-visible:outline-none"
            />
            <button
              type="button"
              aria-pressed={search.picking}
              title="Pick the base in the tree"
              onClick={() => search.setPicking(!search.picking)}
              className={cn(
                'flex h-7 items-center gap-1 rounded-sm px-2 text-xs',
                search.picking
                  ? 'bg-selection-strong text-foreground'
                  : 'hover:bg-hover hover:text-foreground',
              )}
            >
              <Crosshair className="size-3.5" />{' '}
              {search.picking ? 'Select an entry in the tree' : 'Pick in tree'}
            </button>
          </label>
          <label className="flex items-center gap-2">
            Scope
            <select
              aria-label="Scope"
              value={search.params.scope}
              onChange={(event) => search.setParams({ scope: event.target.value as SearchScope })}
              className="h-7 rounded-sm border border-input bg-surface pl-2 text-xs text-foreground"
            >
              {SCOPES.map((scope) => (
                <option key={scope.value} value={scope.value}>
                  {scope.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2">
            Limit
            <input
              aria-label="Size limit"
              inputMode="numeric"
              value={search.params.sizeLimit}
              onChange={(event) => search.setParams({ sizeLimit: event.target.value.replace(/\D/g, '') })}
              className="h-7 w-20 rounded-sm border border-input bg-surface px-2 text-xs text-foreground tabular-nums focus-visible:border-primary focus-visible:outline-none"
            />
          </label>
          {active ? <RecentSearches profileId={active.profileId} /> : null}
        </div>
      </form>
      <Status />
      <div className="min-h-0 flex-1">
        <ResultsTable />
      </div>
    </div>
  )
}

function RecentSearches({ profileId }: { profileId: string }): React.JSX.Element {
  const [recent, setRecent] = useState<SearchParams[]>([])
  const status = useSearch((store) => store.status.state)
  // Reload after each search, since main records it.
  useEffect(() => {
    void window.api.invoke('history.list', { profileId }).then((result) => {
      if (result.ok) {
        setRecent(
          result.value.map((item) => ({
            base: item.base,
            scope: item.scope,
            filter: item.filter,
            attributes: item.attributes.join(', '),
            sizeLimit: String(item.sizeLimit),
          })),
        )
      }
    })
  }, [profileId, status])
  return (
    <DropdownMenu
      label="Recent searches"
      trigger={
        <button
          type="button"
          disabled={recent.length === 0}
          className="flex h-7 items-center gap-1 rounded-sm px-2 text-xs hover:bg-hover hover:text-foreground disabled:opacity-40"
        >
          <History className="size-3.5" /> Recent
        </button>
      }
      items={recent.map((item) => ({
        label: `${item.filter} in ${item.base || 'the root'}`,
        onSelect: () => useSearch.getState().setParams(item),
      }))}
    />
  )
}

function Status(): React.JSX.Element | null {
  const status = useSearch((store) => store.status)
  const total = useSearch((store) => store.results.length)
  const limit = useSearch((store) => store.params.sizeLimit)
  if (status.state === 'idle') {
    return null
  }
  const results = total === 1 ? '1 result' : `${count.format(total)} results`
  const text = (() => {
    switch (status.state) {
      case 'running':
        return status.queued ? 'Waiting for another operation on this connection…' : `Searching… ${results}`
      case 'stopped':
        return `Stopped. ${results}`
      case 'error':
        return `${status.message} ${total > 0 ? `${results} received before the error.` : ''}`
      case 'done':
        if (status.sizeLimitReached) {
          return `${results}. The search stopped at the size limit of ${count.format(Number(limit || DEFAULT_SIZE_LIMIT))}.`
        }
        return status.incomplete ? `${results}. The server did not return all matches.` : results
    }
  })()
  const tone =
    status.state === 'error'
      ? 'text-destructive'
      : status.state === 'done' && (status.sizeLimitReached || status.incomplete)
        ? 'text-warning'
        : 'text-muted-foreground'
  return (
    <p
      role={status.state === 'error' ? 'alert' : 'status'}
      className={cn('shrink-0 px-3.5 py-1.5 text-xs', tone)}
    >
      {text}
    </p>
  )
}

function cellText(entry: SearchEntry, column: string): string {
  const attribute = entry.attributes.find(
    (candidate) => candidate.name.toLowerCase() === column.toLowerCase(),
  )
  return (attribute?.values ?? [])
    .map((value) => (typeof value === 'string' ? value : describeBinary(column, value)))
    .join(', ')
}

/** By the returned object classes when requested, otherwise by the RDN's attribute type. */
function resultKind(entry: SearchEntry): EntryKind {
  const classes = cellText(entry, 'objectClass').split(', ').filter(Boolean)
  const comma = entry.dn.indexOf(',')
  return entryKind(classes, comma < 0 ? entry.dn : entry.dn.slice(0, comma))
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

/** Opens a result in the editor, revealing it in the tree when it is below one of the roots. */
async function openResult(connectionId: string, dn: string, revealOnly = false): Promise<void> {
  const tree = useTree.getState()
  const roots = tree.trees[connectionId]?.rootKeys ?? []
  const parsed = parseDn(dn)
  const inTree =
    parsed.ok &&
    roots.some((root) => {
      const rootDn = parseDn(tree.trees[connectionId]?.nodes[root]?.dn ?? '')
      return rootDn.ok && (keyOf(dn) === root || isDescendantOf(parsed.dn, rootDn.dn))
    })
  if (inTree) {
    await tree.reveal(connectionId, dn)
  } else if (!revealOnly) {
    useEditor.getState().requestOpen(connectionId, dn)
  }
}

function ResultsTable(): React.JSX.Element {
  const results = useSearch((store) => store.results)
  const columns = useSearch((store) => store.columns)
  const sort = useSearch((store) => store.sort)
  const setSort = useSearch((store) => store.setSort)
  const connectionId = useSearch((store) => store.connectionId)
  const status = useSearch((store) => store.status.state)
  const scroller = useRef<HTMLDivElement>(null)

  const rows = useMemo(() => {
    if (!sort) {
      return results
    }
    const value = (entry: SearchEntry) => (sort.column === 'dn' ? entry.dn : cellText(entry, sort.column))
    const sorted = [...results].sort((a, b) => collator.compare(value(a), value(b)))
    return sort.direction === 'ascending' ? sorted : sorted.reverse()
  }, [results, sort])

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scroller.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
  })

  if (status === 'idle') {
    return <EmptyState>Run a search to see its results here.</EmptyState>
  }
  if (results.length === 0 && status !== 'running') {
    return <EmptyState>No entries match the filter.</EmptyState>
  }

  const template = {
    gridTemplateColumns: `minmax(16rem, 2fr) ${columns.map(() => 'minmax(8rem, 1fr)').join(' ')}`,
  }
  const header = (column: string, label: string) => (
    <button
      type="button"
      role="columnheader"
      aria-sort={sort?.column === column ? sort.direction : undefined}
      onClick={() => setSort(column)}
      className="flex min-w-0 items-center gap-1 truncate text-left hover:text-foreground"
    >
      <span className="truncate">{label}</span>
      {sort?.column === column ? (
        sort.direction === 'ascending' ? (
          <ArrowUp className="size-3 shrink-0" aria-hidden />
        ) : (
          <ArrowDown className="size-3 shrink-0" aria-hidden />
        )
      ) : null}
    </button>
  )

  return (
    <div
      role="table"
      aria-label="Search results"
      aria-rowcount={rows.length}
      className="flex h-full flex-col"
    >
      <div
        role="row"
        className="grid shrink-0 gap-4 border-y bg-background px-3.5 py-1.5 text-xs font-medium text-muted-foreground"
        style={template}
      >
        {header('dn', 'DN')}
        {columns.map((column) => (
          <span key={column} className="contents">
            {header(column, column)}
          </span>
        ))}
      </div>
      <div ref={scroller} className="selectable min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
        <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
          {virtualizer.getVirtualItems().map((item) => {
            const entry = rows[item.index]
            if (!entry || !connectionId) {
              return null
            }
            return (
              <ContextMenu
                key={entry.dn}
                label={`Actions for ${entry.dn}`}
                items={[
                  { label: 'Open', onSelect: () => void openResult(connectionId, entry.dn) },
                  { label: 'Show in tree', onSelect: () => void openResult(connectionId, entry.dn, true) },
                  {
                    label: 'Copy DN',
                    onSelect: () => void window.api.invoke('clipboard.writeText', { text: entry.dn }),
                  },
                ]}
              >
                <div
                  role="row"
                  tabIndex={0}
                  aria-rowindex={item.index + 1}
                  aria-label={entry.dn}
                  onDoubleClick={() => void openResult(connectionId, entry.dn)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      void openResult(connectionId, entry.dn)
                    }
                  }}
                  className="absolute inset-x-0 grid items-center gap-4 px-3.5 text-xs outline-none hover:bg-hover focus-visible:bg-selection"
                  style={{ ...template, height: ROW_HEIGHT, transform: `translateY(${item.start}px)` }}
                >
                  <span role="cell" className="flex min-w-0 items-center gap-2" title={entry.dn}>
                    <EntryIcon kind={resultKind(entry)} className="text-subtle-foreground" />
                    <span className="truncate font-mono">{entry.dn}</span>
                  </span>
                  {columns.map((column) => {
                    const text = cellText(entry, column)
                    return (
                      <span key={column} role="cell" className="truncate" title={text}>
                        {text}
                      </span>
                    )
                  })}
                </div>
              </ContextMenu>
            )
          })}
        </div>
      </div>
    </div>
  )
}
