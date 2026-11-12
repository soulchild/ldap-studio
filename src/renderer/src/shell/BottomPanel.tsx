import { ChevronDown, ChevronUp } from 'lucide-react'
import { IconButton } from '@renderer/components/IconButton'
import { cn } from '@renderer/lib/utils'
import { BOTTOM_BAR_HEIGHT } from './layout-defaults'
import { LogPanel } from './LogPanel'
import { SearchPanel } from '@renderer/search/SearchPanel'
import type { BottomTab } from '@renderer/state/layout'

const TABS: { id: BottomTab; label: string }[] = [
  { id: 'search', label: 'Search' },
  { id: 'log', label: 'Log' },
]

/** Search results and the operation log, with a tab bar that stays visible when collapsed. */
export function BottomPanel({
  tab,
  collapsed,
  onTabChange,
  onToggle,
}: {
  tab: BottomTab
  collapsed: boolean
  onTabChange: (tab: BottomTab) => void
  onToggle: () => void
}): React.JSX.Element {
  return (
    <section className="flex h-full flex-col" aria-label="Search and log">
      <div
        className="flex shrink-0 items-center justify-between gap-2 border-b px-3"
        style={{ height: BOTTOM_BAR_HEIGHT }}
      >
        <div role="tablist" aria-label="Bottom panel" className="flex h-full items-stretch gap-1">
          {TABS.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              id={`bottom-tab-${item.id}`}
              aria-selected={tab === item.id}
              aria-controls="bottom-tabpanel"
              onClick={() => onTabChange(item.id)}
              className={cn(
                'relative h-full px-2.5 text-xs font-medium transition-colors',
                tab === item.id && !collapsed
                  ? 'text-foreground after:absolute after:inset-x-2 after:-bottom-px after:h-0.5 after:rounded-full after:bg-primary'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {item.label}
            </button>
          ))}
        </div>
        <IconButton label={collapsed ? 'Expand panel' : 'Collapse panel'} onClick={onToggle}>
          {collapsed ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
        </IconButton>
      </div>
      {collapsed ? null : (
        <div
          id="bottom-tabpanel"
          role="tabpanel"
          aria-labelledby={`bottom-tab-${tab}`}
          className="min-h-0 flex-1"
        >
          {tab === 'search' ? <SearchPanel /> : <LogPanel />}
        </div>
      )}
    </section>
  )
}
