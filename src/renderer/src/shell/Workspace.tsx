import { Keyboard, Search } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Group, Panel, useGroupRef } from 'react-resizable-panels'
import { EntryActionDialogs } from '@renderer/actions/EntryActionDialogs'
import { IconButton } from '@renderer/components/IconButton'
import { EditorPane } from '@renderer/editor/EditorPane'
import { ConnectionsPane } from '@renderer/connections/ConnectionsPane'
import { openSearch } from '@renderer/search/open'
import { useSettings } from '@renderer/state/settings'
import { DirectoryPane } from '@renderer/tree/DirectoryPane'
import type { Settings } from '@shared/settings'
import { BottomPanel } from './BottomPanel'
import { useLayout, type BottomTab } from '@renderer/state/layout'
import { DnLookup } from './DnLookup'
import { BOTTOM_BAR_HEIGHT, DEFAULT_PANE_SIZES } from './layout-defaults'
import { ResizeHandle } from './ResizeHandle'
import { SHORTCUTS, shortcutText, useShortcut } from './shortcuts'
import { ShortcutsDialog } from './ShortcutsDialog'
import { useFixedPane } from './useFixedPane'

/**
 * The main window (app-shell spec: multi-pane workspace): directory tree above connections on
 * the left, the entry editor in the main area, results and log below it. The sidebar, the
 * connections pane and the bottom panel keep their pixel size when the window is resized.
 */
export function Workspace({ settings }: { settings: Settings }): React.JSX.Element {
  const update = useSettings((state) => state.update)
  const [collapsed, setCollapsed] = useState(settings.bottomPanelCollapsed)
  const tab = useLayout((store) => store.bottomTab)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  useShortcut(SHORTCUTS.search, openSearch)
  useShortcut(SHORTCUTS.help, () => setShortcutsOpen((open) => !open), { inDialogs: true })

  const size = (id: string) => settings.paneSizes[id] ?? DEFAULT_PANE_SIZES[id] ?? 240
  const remember = (id: string) => (pixels: number) => {
    const current = useSettings.getState().settings?.paneSizes ?? {}
    update({ paneSizes: { ...current, [id]: pixels } })
  }

  const mainGroup = useGroupRef()
  const mainElement = useRef<HTMLDivElement>(null)
  const onMainLayout = useFixedPane({
    groupRef: mainGroup,
    elementRef: mainElement,
    axis: 'horizontal',
    fixedId: 'sidebar',
    flexibleId: 'content',
    initialSize: size('sidebar'),
    onUserResize: remember('sidebar'),
  })

  const sidebarGroup = useGroupRef()
  const sidebarElement = useRef<HTMLDivElement>(null)
  const onSidebarLayout = useFixedPane({
    groupRef: sidebarGroup,
    elementRef: sidebarElement,
    axis: 'vertical',
    fixedId: 'connections',
    flexibleId: 'directory',
    initialSize: size('connections'),
    onUserResize: remember('connections'),
  })

  const contentGroup = useGroupRef()
  const contentElement = useRef<HTMLDivElement>(null)
  const onContentLayout = useFixedPane({
    groupRef: contentGroup,
    elementRef: contentElement,
    axis: 'vertical',
    fixedId: 'bottom',
    flexibleId: 'editor',
    initialSize: size('bottom'),
    onUserResize: remember('bottom'),
    overrideSize: collapsed ? BOTTOM_BAR_HEIGHT : undefined,
  })

  const setCollapsedState = (next: boolean) => {
    if (next !== collapsed) {
      setCollapsed(next)
      update({ bottomPanelCollapsed: next })
    }
  }

  // Something asked to show a bottom tab (e.g. the Search button): expand the panel.
  useEffect(
    () =>
      useLayout.subscribe((store, previous) => {
        if (store.revealRequest !== previous.revealRequest) {
          setCollapsed(false)
          update({ bottomPanelCollapsed: false })
        }
      }),
    [update],
  )

  const showTab = (next: BottomTab) => {
    useLayout.getState().setBottomTab(next)
    setCollapsedState(false)
  }

  return (
    <>
      <EntryActionDialogs />
      <ShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
      <Group
        id="main-layout"
        orientation="horizontal"
        groupRef={mainGroup}
        elementRef={mainElement}
        onLayoutChanged={onMainLayout}
      >
        <Panel
          id="sidebar"
          defaultSize={`${size('sidebar')}px`}
          minSize={220}
          maxSize="60%"
          className="bg-background"
        >
          <Group
            id="sidebar-layout"
            orientation="vertical"
            groupRef={sidebarGroup}
            elementRef={sidebarElement}
            onLayoutChanged={onSidebarLayout}
          >
            <Panel id="directory" minSize={120}>
              <DirectoryPane />
            </Panel>
            <ResizeHandle orientation="vertical" />
            <Panel id="connections" defaultSize={`${size('connections')}px`} minSize={96}>
              <ConnectionsPane />
            </Panel>
          </Group>
        </Panel>
        <ResizeHandle orientation="horizontal" />
        <Panel id="content" minSize={400}>
          <div className="flex h-full flex-col">
            <div className="flex h-11 shrink-0 items-center gap-3 border-b bg-surface px-3.5">
              <DnLookup />
              <button
                type="button"
                onClick={openSearch}
                title={`Search  ${shortcutText(SHORTCUTS.search)}`}
                className="flex h-8 shrink-0 items-center gap-1.5 rounded-sm px-2.5 text-sm text-muted-foreground hover:bg-hover hover:text-foreground"
              >
                <Search className="size-4" /> Search
              </button>
              <IconButton
                label={`Keyboard shortcuts  ${shortcutText(SHORTCUTS.help)}`}
                className="ml-auto size-8"
                onClick={() => setShortcutsOpen(true)}
              >
                <Keyboard className="size-4" />
              </IconButton>
            </div>
            <div className="min-h-0 flex-1">
              <Group
                id="content-layout"
                orientation="vertical"
                groupRef={contentGroup}
                elementRef={contentElement}
                onLayoutChanged={onContentLayout}
              >
                <Panel id="editor" minSize={160} className="bg-surface">
                  <EditorPane />
                </Panel>
                <ResizeHandle orientation="vertical" />
                {/* The first render already uses the saved sizes; useFixedPane keeps them afterwards. */}
                <Panel
                  id="bottom"
                  defaultSize={`${collapsed ? BOTTOM_BAR_HEIGHT : size('bottom')}px`}
                  minSize={collapsed ? BOTTOM_BAR_HEIGHT : 120}
                  disabled={collapsed}
                >
                  <BottomPanel
                    tab={tab}
                    collapsed={collapsed}
                    onTabChange={showTab}
                    onToggle={() => setCollapsedState(!collapsed)}
                  />
                </Panel>
              </Group>
            </div>
          </div>
        </Panel>
      </Group>
    </>
  )
}
