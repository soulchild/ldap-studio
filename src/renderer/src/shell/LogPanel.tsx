import { useVirtualizer } from '@tanstack/react-virtual'
import { useEffect, useMemo, useRef, useState } from 'react'
import { EmptyState } from '@renderer/components/EmptyState'
import { cn } from '@renderer/lib/utils'
import { useLog } from '@renderer/state/log'
import type { LogRecord } from '@shared/ipc'
import { resultName } from '@shared/result-codes'

const ROW_HEIGHT = 32
/** Fixed columns stay narrow; DN and details share the rest and truncate, so nothing scrolls sideways. */
const COLUMNS = 'grid-cols-[4.5rem_minmax(0,8rem)_4.5rem_minmax(0,3fr)_minmax(0,2fr)_minmax(0,8rem)_4.5rem]'

const OPERATION_LABELS: Record<LogRecord['operation'], string> = {
  bind: 'Bind',
  search: 'Search',
  add: 'Add',
  modify: 'Modify',
  modifyDn: 'Rename',
  delete: 'Delete',
  extended: 'Extended',
}

const time = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })

function resultLabel(record: LogRecord): string {
  if (record.resultCode === -1) {
    return 'failed'
  }
  return record.resultCode === 0 ? 'success' : resultName(record.resultCode)
}

/** Every directory operation with its result (app-shell spec: operation log). */
export function LogPanel(): React.JSX.Element {
  const records = useLog((state) => state.records)
  const [connection, setConnection] = useState('all')
  const scroller = useRef<HTMLDivElement>(null)
  const atBottom = useRef(true)

  const connections = useMemo(() => {
    const names = new Map<string, string>()
    for (const record of records) {
      names.set(record.connectionId, record.profileName)
    }
    return [...names]
  }, [records])

  const visible = useMemo(
    () => (connection === 'all' ? records : records.filter((record) => record.connectionId === connection)),
    [records, connection],
  )

  const virtualizer = useVirtualizer({
    count: visible.length,
    getScrollElement: () => scroller.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
  })

  // Keep following new records while the list is scrolled to the end.
  useEffect(() => {
    if (atBottom.current && visible.length > 0) {
      virtualizer.scrollToIndex(visible.length - 1, { align: 'end' })
    }
  }, [visible.length, virtualizer])

  if (records.length === 0) {
    return <EmptyState>Every directory operation will be listed here.</EmptyState>
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-10 shrink-0 items-center gap-3 border-b px-4">
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          Connection
          <select
            value={connection}
            onChange={(event) => setConnection(event.target.value)}
            className="h-7 rounded-sm border border-input bg-surface px-2 text-xs text-foreground"
          >
            <option value="all">All connections</option>
            {connections.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <span className="text-xs text-subtle-foreground">
          {visible.length === 1 ? '1 operation' : `${visible.length} operations`}
        </span>
      </div>
      <div
        className={cn(
          'grid shrink-0 gap-3 border-b px-4 py-2 text-xs font-medium text-muted-foreground',
          COLUMNS,
        )}
        role="row"
      >
        <span role="columnheader">Time</span>
        <span role="columnheader">Connection</span>
        <span role="columnheader">Operation</span>
        <span role="columnheader">Entry</span>
        <span role="columnheader">Details</span>
        <span role="columnheader">Result</span>
        <span role="columnheader" className="text-right">
          Duration
        </span>
      </div>
      <div
        ref={scroller}
        role="table"
        aria-label="Operation log"
        aria-rowcount={visible.length}
        className="selectable min-h-0 flex-1 overflow-y-auto overflow-x-hidden"
        onScroll={(event) => {
          const element = event.currentTarget
          atBottom.current = element.scrollHeight - element.scrollTop - element.clientHeight < ROW_HEIGHT
        }}
      >
        <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
          {virtualizer.getVirtualItems().map((item) => {
            const record = visible[item.index]
            if (!record) {
              return null
            }
            const failed = record.resultCode !== 0
            return (
              <div
                key={record.id}
                role="row"
                aria-rowindex={item.index + 1}
                className={cn('absolute inset-x-0 grid items-center gap-3 px-4 text-xs', COLUMNS)}
                style={{ height: ROW_HEIGHT, transform: `translateY(${item.start}px)` }}
              >
                <span role="cell" className="tabular-nums text-muted-foreground">
                  {time.format(new Date(record.timestamp))}
                </span>
                <span role="cell" className="truncate">
                  {record.profileName}
                </span>
                <span role="cell">{OPERATION_LABELS[record.operation]}</span>
                <span role="cell" className="truncate font-mono" title={record.dn}>
                  {record.dn || '(root)'}
                </span>
                <span role="cell" className="truncate text-muted-foreground" title={record.message}>
                  {record.message}
                </span>
                <span
                  role="cell"
                  className={cn('truncate', failed ? 'text-destructive' : 'text-muted-foreground')}
                >
                  {resultLabel(record)}
                </span>
                <span role="cell" className="text-right tabular-nums text-muted-foreground">
                  {record.durationMs} ms
                </span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
