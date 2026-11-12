import { useVirtualizer } from '@tanstack/react-virtual'
import { ChevronRight } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@renderer/components/ui/button'
import { Dialog } from '@renderer/components/ui/dialog'
import { cn } from '@renderer/lib/utils'
import { useTree } from '@renderer/state/tree'
import { EntryIcon } from '@renderer/tree/EntryIcon'
import { entryKind } from '@renderer/tree/entry-kind'
import {
  appendChildren,
  createTree,
  failLoading,
  finishLoading,
  flatten,
  isExpandable,
  keyOf,
  setExpanded,
  startLoading,
  type Tree,
} from '@renderer/tree/model'
import { readTreeNode } from '@renderer/tree/read-node'
import { ancestorsOf, parseDn, serializeDn } from '@shared/dn'

const ROW_HEIGHT = 28
const INDENT = 16

/**
 * Picks an entry from the directory for a DN-valued attribute (entry-editing spec: choose DN
 * values). Its own tree, so browsing here leaves the main tree as it is; it opens at the
 * current value when that is an entry below one of the roots.
 */
export function DnPickerDialog({
  connectionId,
  attribute,
  initialDn,
  onChoose,
  onCancel,
}: {
  connectionId: string
  attribute: string
  initialDn: string
  onChoose: (dn: string) => void
  onCancel: () => void
}): React.JSX.Element {
  const rootDns = useMemo(() => {
    const main = useTree.getState().trees[connectionId]
    return main ? main.rootKeys.map((key) => main.nodes[key]?.dn ?? key) : []
  }, [connectionId])
  const [tree, setTree] = useState<Tree>(() => createTree(rootDns))
  const [selected, setSelected] = useState<string>()
  // The tree as of the last change, for loaders that outlive a render.
  const latest = useRef(tree)
  const cancels = useRef(new Set<() => void>())

  const update = (change: (current: Tree) => Tree) => {
    latest.current = change(latest.current)
    setTree(latest.current)
  }

  /** Loads a node's children; resolves when they are all there (or loading failed). */
  const load = (key: string): Promise<void> =>
    new Promise((resolve) => {
      const node = latest.current.nodes[key]
      if (!node) {
        resolve()
        return
      }
      update((current) => startLoading(current, key))
      void window.api
        .stream('tree.children', { connectionId, dn: node.dn }, (event) => {
          switch (event.kind) {
            case 'page':
              update((current) => appendChildren(current, key, event.data.nodes))
              break
            case 'done':
              update((current) => finishLoading(current, key, event.data.incomplete))
              resolve()
              break
            case 'error':
              update((current) =>
                event.error.kind === 'cancelled'
                  ? finishLoading(current, key, true)
                  : failLoading(current, key, event.error.message),
              )
              resolve()
              break
          }
        })
        .then((started) => {
          cancels.current.add(started.cancel)
        })
        .catch(() => resolve())
    })

  const expand = async (key: string) => {
    const node = latest.current.nodes[key]
    if (!node || !isExpandable(node)) {
      return
    }
    update((current) => setExpanded(current, key, true))
    if (node.childKeys === undefined || node.error !== undefined) {
      await load(key)
    }
  }
  const collapse = (key: string) => update((current) => setExpanded(current, key, false))

  // The list's scroll container only exists once the dialog has mounted (it renders in a
  // portal); render again then, or the virtual list measures nothing and stays empty.
  const [, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  // Open at the current value: load the entries down to it and select it. Without one (a new,
  // empty value, or a DN outside the tree), open the first root so there is something to pick.
  useEffect(() => {
    let stopped = false
    const parsed = parseDn(initialDn.trim())
    const path =
      parsed.ok && parsed.dn.length > 0
        ? [...ancestorsOf(parsed.dn), parsed.dn].map((level) => keyOf(serializeDn(level)))
        : []
    const start = path.findIndex((key) => latest.current.rootKeys.includes(key))
    if (start >= 0 && parsed.ok) {
      const dns = [...ancestorsOf(parsed.dn), parsed.dn].map((level) => serializeDn(level))
      void (async () => {
        // The deepest entry reached, selected if the value itself cannot be.
        let reached = path[start] as string
        for (let index = start; index < path.length - 1; index++) {
          const key = path[index] as string
          await expand(key)
          if (stopped) {
            return
          }
          // An entry the server's list stopped before (size or permission limit) is read
          // directly and added.
          const nextKey = path[index + 1] as string
          if (!latest.current.nodes[nextKey]) {
            const next = await readTreeNode(connectionId, dns[index + 1] as string)
            if (stopped) {
              return
            }
            if (!next) {
              break
            }
            update((current) => appendChildren(current, key, [next]))
          }
          reached = nextKey
        }
        setSelected(reached)
      })()
    } else {
      const first = latest.current.rootKeys[0]
      if (first) {
        setSelected(first)
        void expand(first)
      }
    }
    const pending = cancels.current
    return () => {
      stopped = true
      pending.forEach((cancel) => cancel())
    }
    // Only once, for the value the dialog opened with.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const rows = useMemo(() => flatten(tree), [tree])
  const nodeRows = rows.filter((row) => row.kind === 'node')
  const scroller = useRef<HTMLDivElement>(null)
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scroller.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
  })
  const selectedIndex = rows.findIndex((row) => row.kind === 'node' && row.key === selected)
  useEffect(() => {
    if (selectedIndex >= 0) {
      virtualizer.scrollToIndex(selectedIndex, { align: 'auto' })
    }
  }, [selectedIndex, virtualizer])

  const selectedDn = selected ? tree.nodes[selected]?.dn : undefined
  const choose = () => {
    if (selectedDn) {
      onChoose(selectedDn)
    }
  }
  const move = (offset: number) => {
    const position = nodeRows.findIndex((row) => row.key === selected)
    const next = nodeRows[Math.min(Math.max(position + offset, 0), nodeRows.length - 1)]
    if (next) {
      setSelected(next.key)
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) {
          onCancel()
        }
      }}
      title={`Choose ${attribute}`}
      className="w-[min(40rem,calc(100vw-2rem))]"
      footer={
        <>
          <p className="mr-auto min-w-0 truncate font-mono text-xs text-muted-foreground" title={selectedDn}>
            {selectedDn ?? 'Select an entry.'}
          </p>
          <Button onClick={onCancel}>Cancel</Button>
          <Button variant="primary" disabled={!selectedDn} onClick={choose}>
            Choose
          </Button>
        </>
      }
    >
      <div
        ref={scroller}
        role="tree"
        aria-label="Entries to choose from"
        tabIndex={0}
        aria-activedescendant={selected ? `picker-${selected}` : undefined}
        onKeyDown={(event) => {
          const node = selected ? tree.nodes[selected] : undefined
          switch (event.key) {
            case 'ArrowDown':
              event.preventDefault()
              move(node ? 1 : 0)
              break
            case 'ArrowUp':
              event.preventDefault()
              move(-1)
              break
            case 'ArrowRight':
              event.preventDefault()
              if (node && !node.expanded) {
                void expand(node.key)
              }
              break
            case 'ArrowLeft':
              event.preventDefault()
              if (node?.expanded) {
                collapse(node.key)
              } else if (node?.parentKey) {
                setSelected(node.parentKey)
              }
              break
            case 'Enter':
              event.preventDefault()
              choose()
              break
          }
        }}
        className="-mx-2 h-80 overflow-y-auto rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
          {virtualizer.getVirtualItems().map((item) => {
            const row = rows[item.index]
            const node = row ? tree.nodes[row.key] : undefined
            if (!row || !node) {
              return null
            }
            const style = { height: ROW_HEIGHT, transform: `translateY(${item.start}px)` }
            const indent = 8 + row.depth * INDENT
            if (row.kind !== 'node') {
              return (
                <div
                  key={`${row.kind}:${row.key}`}
                  className={cn(
                    'absolute inset-x-0 flex items-center text-xs',
                    row.kind === 'error' ? 'text-destructive' : 'text-muted-foreground',
                  )}
                  style={{ ...style, paddingLeft: indent + 42 }}
                >
                  {row.kind === 'loading'
                    ? 'Loading…'
                    : row.kind === 'error'
                      ? node.error
                      : 'Showing part of the entries. Use Go to DN for others.'}
                </div>
              )
            }
            const isSelected = row.key === selected
            return (
              <div key={row.key} className="absolute inset-x-0 px-2" style={style}>
                <div
                  id={`picker-${row.key}`}
                  role="treeitem"
                  aria-level={row.depth + 1}
                  aria-selected={isSelected}
                  aria-expanded={isExpandable(node) ? node.expanded : undefined}
                  aria-label={node.rdn}
                  onClick={() => setSelected(row.key)}
                  onDoubleClick={() => {
                    setSelected(row.key)
                    onChoose(node.dn)
                  }}
                  className={cn(
                    'flex h-full items-center gap-1 rounded-sm pr-2 text-sm',
                    isSelected ? 'bg-selection-strong' : 'hover:bg-hover',
                  )}
                  style={{ paddingLeft: indent }}
                >
                  {isExpandable(node) ? (
                    <button
                      type="button"
                      tabIndex={-1}
                      aria-label={node.expanded ? `Collapse ${node.rdn}` : `Expand ${node.rdn}`}
                      onClick={(event) => {
                        event.stopPropagation()
                        if (node.expanded) {
                          collapse(row.key)
                        } else {
                          void expand(row.key)
                        }
                      }}
                      className="flex size-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:text-foreground"
                    >
                      <ChevronRight
                        className={cn('size-3.5 transition-transform', node.expanded && 'rotate-90')}
                      />
                    </button>
                  ) : (
                    <span className="size-5 shrink-0" />
                  )}
                  <EntryIcon
                    kind={entryKind(node.objectClasses, node.rdn)}
                    className={isSelected ? 'text-primary' : 'text-subtle-foreground'}
                  />
                  <span className={cn('min-w-0 flex-1 truncate', node.depth === 0 && 'font-medium')}>
                    {node.rdn}
                  </span>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </Dialog>
  )
}
