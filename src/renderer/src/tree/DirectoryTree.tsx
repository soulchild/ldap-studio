import { useVirtualizer } from '@tanstack/react-virtual'
import { ChevronRight } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { isWithin } from '@renderer/actions/helpers'
import { ContextMenu } from '@renderer/components/ui/context-menu'
import { cn } from '@renderer/lib/utils'
import { Button } from '@renderer/components/ui/button'
import { EntryIcon } from './EntryIcon'
import { entryKind } from './entry-kind'
import { escapeDnValue, parseDn } from '@shared/dn'
import { useEntryActions, type EntryAction } from '@renderer/state/actions'
import { useTree } from '@renderer/state/tree'
import { flatten, isExpandable, type Tree, type TreeNode, type TreeRow } from './model'

const ROW_HEIGHT = 28
const INDENT = 16
const count = new Intl.NumberFormat()

/** A DN or RDN with each attribute type muted and each value in normal weight. */
export function RdnLabel({ rdn }: { rdn: string }): React.JSX.Element {
  const parsed = parseDn(rdn)
  if (!parsed.ok || parsed.dn.length === 0) {
    return <span>{rdn}</span>
  }
  return (
    <span className="truncate">
      {parsed.dn.map((segment, index) => (
        <span key={index}>
          {index > 0 ? <span className="text-muted-foreground">,</span> : null}
          {segment.map((ava, avaIndex) => (
            <span key={avaIndex}>
              {avaIndex > 0 ? <span className="text-muted-foreground">+</span> : null}
              <span className="text-muted-foreground">{ava.type}=</span>
              <span>{ava.isHex ? ava.value : escapeDnValue(ava.value)}</span>
            </span>
          ))}
        </span>
      ))}
    </span>
  )
}

const rowId = (row: TreeRow) => `tree-${row.kind}-${row.key}`

function copyDn(dn: string): void {
  void window.api.invoke('clipboard.writeText', { text: dn })
}

/** The directory of one connection as a virtualized, keyboard-navigable tree (directory-tree spec). */
export function DirectoryTree({
  connectionId,
  tree,
  readOnly,
}: {
  connectionId: string
  tree: Tree
  readOnly?: boolean
}): React.JSX.Element {
  const selected = useTree((store) => store.selected[connectionId])
  const store = useTree.getState()
  const { collapse, select, cancel, refresh } = store
  // On a lost connection only already-loaded nodes can be opened; nothing new is fetched.
  const canLoad = (key: string) => !readOnly || tree.nodes[key]?.childKeys !== undefined
  const expand = (connection: string, key: string) => {
    if (canLoad(key)) {
      store.expand(connection, key)
    }
  }
  const toggle = (connection: string, key: string) => {
    if (tree.nodes[key]?.expanded) {
      store.collapse(connection, key)
    } else {
      expand(connection, key)
    }
  }
  const rows = useMemo(() => flatten(tree), [tree])
  const dragged = useRef<TreeNode | undefined>(undefined)
  const [dropTarget, setDropTarget] = useState<string>()
  const act = (kind: EntryAction, dn: string) => useEntryActions.getState().start({ kind, connectionId, dn })
  /** Drop targets: not the entry itself, not below it, and not its current parent. */
  const canDrop = (target: TreeNode) => {
    const source = dragged.current
    return (
      !readOnly &&
      source !== undefined &&
      target.key !== source.key &&
      target.key !== source.parentKey &&
      !isWithin(target.dn, source.dn)
    )
  }
  const nodeRows = useMemo(() => rows.filter((row) => row.kind === 'node'), [rows])
  const scroller = useRef<HTMLDivElement>(null)

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scroller.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 16,
  })

  const selectedIndex = selected ? rows.findIndex((row) => row.kind === 'node' && row.key === selected) : -1
  useEffect(() => {
    if (selectedIndex >= 0) {
      virtualizer.scrollToIndex(selectedIndex, { align: 'auto' })
    }
  }, [selectedIndex, virtualizer])

  const moveSelection = (offset: number) => {
    const position = nodeRows.findIndex((row) => row.key === selected)
    const next = nodeRows[Math.min(Math.max(position + offset, 0), nodeRows.length - 1)]
    if (next) {
      select(connectionId, next.key)
    }
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).tagName === 'INPUT') {
      return
    }
    const node = selected ? tree.nodes[selected] : undefined
    const handled = () => event.preventDefault()
    switch (event.key) {
      case 'ArrowDown':
        handled()
        moveSelection(node ? 1 : 0)
        break
      case 'ArrowUp':
        handled()
        moveSelection(-1)
        break
      case 'Home':
        handled()
        moveSelection(-Infinity)
        break
      case 'End':
        handled()
        moveSelection(Infinity)
        break
      case 'ArrowRight':
        handled()
        if (node && isExpandable(node) && !node.expanded) {
          expand(connectionId, node.key)
        } else if (node?.expanded && node.childKeys?.[0]) {
          moveSelection(1)
        }
        break
      case 'ArrowLeft':
        handled()
        if (node?.expanded) {
          collapse(connectionId, node.key)
        } else if (node?.parentKey) {
          select(connectionId, node.parentKey)
        }
        break
      case 'Enter':
        handled()
        if (node) {
          toggle(connectionId, node.key)
        }
        break
      case 'c':
        if ((event.metaKey || event.ctrlKey) && node) {
          handled()
          copyDn(node.dn)
        }
        break
    }
  }

  return (
    <div
      ref={scroller}
      role="tree"
      aria-label="Directory tree"
      aria-readonly={readOnly ? true : undefined}
      tabIndex={0}
      aria-activedescendant={selectedIndex >= 0 ? rowId(rows[selectedIndex]!) : undefined}
      onKeyDown={onKeyDown}
      onFocus={() => {
        if (!selected && nodeRows[0]) {
          select(connectionId, nodeRows[0].key)
        }
      }}
      className="h-full overflow-y-auto outline-none"
    >
      <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
        {virtualizer.getVirtualItems().map((item) => {
          const row = rows[item.index]
          const node = row ? tree.nodes[row.key] : undefined
          if (!row || !node) {
            return null
          }
          const style = { height: ROW_HEIGHT, transform: `translateY(${item.start}px)` }
          const indent = { paddingLeft: 8 + row.depth * INDENT }
          return (
            <div key={rowId(row)} className="absolute inset-x-0 px-2" style={style}>
              {row.kind === 'node' ? (
                <ContextMenu
                  label={`Actions for ${node.rdn}`}
                  items={[
                    { label: 'New entry…', onSelect: () => act('create', node.dn), disabled: readOnly },
                    {
                      label: 'Copy entry…',
                      onSelect: () => act('copy', node.dn),
                      disabled: readOnly || node.depth === 0,
                    },
                    {
                      label: 'Rename…',
                      onSelect: () => act('rename', node.dn),
                      disabled: readOnly || node.depth === 0,
                    },
                    {
                      label: 'Move…',
                      onSelect: () => act('move', node.dn),
                      disabled: readOnly || node.depth === 0,
                    },
                    'separator',
                    { label: 'Copy DN', onSelect: () => copyDn(node.dn) },
                    'separator',
                    {
                      label: 'Refresh',
                      onSelect: () => refresh(connectionId, node.key),
                      disabled: readOnly || !isExpandable(node),
                    },
                    'separator',
                    {
                      label: 'Delete…',
                      onSelect: () => act('delete', node.dn),
                      disabled: readOnly || node.depth === 0,
                      destructive: true,
                    },
                  ]}
                >
                  {/* A DOM element, so the menu trigger can attach its handlers and ref. */}
                  <div
                    className={cn(
                      'h-full rounded-sm',
                      dropTarget === node.key && 'outline-2 -outline-offset-2 outline-primary',
                    )}
                    draggable={!readOnly && node.depth > 0}
                    onDragStart={(event) => {
                      dragged.current = node
                      event.dataTransfer.effectAllowed = 'move'
                      event.dataTransfer.setData('text/plain', node.dn)
                    }}
                    onDragEnd={() => {
                      dragged.current = undefined
                      setDropTarget(undefined)
                    }}
                    onDragOver={(event) => {
                      if (canDrop(node)) {
                        event.preventDefault()
                        event.dataTransfer.dropEffect = 'move'
                        setDropTarget(node.key)
                      }
                    }}
                    onDragLeave={() =>
                      setDropTarget((current) => (current === node.key ? undefined : current))
                    }
                    onDrop={(event) => {
                      event.preventDefault()
                      setDropTarget(undefined)
                      const source = dragged.current
                      // Check before clearing: canDrop reads the dragged entry.
                      const allowed = canDrop(node)
                      dragged.current = undefined
                      if (source && allowed) {
                        useEntryActions.getState().start({
                          kind: 'move',
                          connectionId,
                          dn: source.dn,
                          newParent: node.dn,
                        })
                      }
                    }}
                  >
                    <NodeRow
                      id={rowId(row)}
                      node={node}
                      style={indent}
                      selected={selected === node.key}
                      onSelect={() => select(connectionId, node.key)}
                      onToggle={() => toggle(connectionId, node.key)}
                    />
                  </div>
                </ContextMenu>
              ) : (
                <StatusRow
                  row={row}
                  node={node}
                  style={indent}
                  onCancel={() => cancel(connectionId, node.key)}
                  onRetry={() => refresh(connectionId, node.key)}
                />
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function NodeRow({
  id,
  node,
  style,
  selected,
  onSelect,
  onToggle,
}: {
  id: string
  node: TreeNode
  style: React.CSSProperties
  selected: boolean
  onSelect: () => void
  onToggle: () => void
}): React.JSX.Element {
  const expandable = isExpandable(node)
  const loadedCount = node.childKeys?.length ?? 0
  return (
    <div
      id={id}
      role="treeitem"
      aria-level={node.depth + 1}
      aria-selected={selected}
      aria-expanded={expandable ? node.expanded : undefined}
      aria-label={node.rdn}
      data-dn={node.dn}
      onClick={onSelect}
      onDoubleClick={() => expandable && onToggle()}
      className={cn(
        'flex h-full items-center gap-1 rounded-sm pr-2 text-sm',
        selected ? 'bg-selection-strong' : 'hover:bg-hover',
      )}
      style={style}
    >
      {expandable ? (
        <button
          type="button"
          tabIndex={-1}
          aria-label={node.expanded ? `Collapse ${node.rdn}` : `Expand ${node.rdn}`}
          onClick={(event) => {
            event.stopPropagation()
            onSelect()
            onToggle()
          }}
          className="flex size-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:text-foreground"
        >
          <ChevronRight className={cn('size-3.5 transition-transform', node.expanded && 'rotate-90')} />
        </button>
      ) : (
        <span className="size-5 shrink-0" />
      )}
      <EntryIcon
        kind={entryKind(node.objectClasses, node.rdn)}
        className={selected ? 'text-primary' : 'text-subtle-foreground'}
      />
      <span className={cn('min-w-0 flex-1 truncate', node.depth === 0 && 'font-medium')}>
        <RdnLabel rdn={node.rdn} />
      </span>
      {node.expanded && (loadedCount > 0 || node.loading) ? (
        <span className="shrink-0 text-xs tabular-nums text-subtle-foreground">
          {count.format(loadedCount)}
          {node.loading ? '…' : ''}
        </span>
      ) : null}
    </div>
  )
}

function StatusRow({
  row,
  node,
  style,
  onCancel,
  onRetry,
}: {
  row: TreeRow
  node: TreeNode
  style: React.CSSProperties
  onCancel: () => void
  onRetry: () => void
}): React.JSX.Element {
  const loaded = count.format(node.childKeys?.length ?? 0)
  // Lines up with the names of child rows: chevron (20) + gap (4) + icon (14) + gap (4).
  const textStyle = { ...style, paddingLeft: Number(style.paddingLeft) + 42 }
  switch (row.kind) {
    case 'loading':
      return (
        <div
          role="status"
          className="flex h-full items-center gap-2 text-xs text-muted-foreground"
          style={textStyle}
        >
          <span>
            {node.queued ? 'Waiting for another operation on this connection…' : `Loading… ${loaded}`}
          </span>
          <Button variant="ghost" size="inline" className="font-medium" onClick={onCancel}>
            Stop
          </Button>
        </div>
      )
    case 'incomplete':
      return (
        <div role="status" className="flex h-full items-center gap-2 text-xs text-warning" style={textStyle}>
          <span>Showing {loaded} entries. The list is incomplete.</span>
          <Button variant="ghost" size="inline" className="font-medium" onClick={onRetry}>
            Load all
          </Button>
        </div>
      )
    case 'error':
      return (
        <div
          role="alert"
          className="flex h-full items-center gap-2 text-xs text-destructive"
          style={textStyle}
        >
          <span className="truncate" title={node.error}>
            {node.error}
          </span>
          <Button variant="ghost" size="inline" className="font-medium" onClick={onRetry}>
            Try again
          </Button>
        </div>
      )
    default:
      return <div />
  }
}
