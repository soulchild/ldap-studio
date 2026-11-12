import { useEffect, useRef, useState } from 'react'
import { Group, Panel, useGroupRef } from 'react-resizable-panels'
import { EntryActionDialogs } from '@renderer/actions/EntryActionDialogs'
import { EditorPane } from '@renderer/editor/EditorPane'
import { ConnectionsPane } from '@renderer/connections/ConnectionsPane'
import { openSearch } from '@renderer/search/open'
import { useSettings } from '@renderer/state/settings'
import { DirectoryPane } from '@renderer/tree/DirectoryPane'
import type { Settings } from '@shared/settings'
import { BottomPanel } from './BottomPanel'
import { useLayout, type BottomTab } from '@renderer/state/layout'
import { useUi, type Overlay } from '@renderer/state/ui'
import { CommandPalette } from './CommandPalette'
import { GoToDnDialog } from './GoToDnDialog'
import { BOTTOM_BAR_HEIGHT, DEFAULT_PANE_SIZES } from './layout-defaults'
import { ResizeHandle } from './ResizeHandle'
import { SHORTCUTS, useShortcut } from './shortcuts'
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
  const overlay = useUi((store) => store.overlay)
  useShortcut(SHORTCUTS.search, openSearch)
  // These switch between the workspace's own overlays, but leave other dialogs alone.
  const overlayShortcut = (target: Overlay) => () => {
    const current = useUi.getState().overlay
    if (current === undefined && document.querySelector('[role="dialog"], [role="alertdialog"]')) {
      return
    }
    useUi.getState().toggle(target)
  }
  useShortcut(SHORTCUTS.palette, overlayShortcut('palette'), { inDialogs: true })
  useShortcut(SHORTCUTS.dnLookup, overlayShortcut('goToDn'), { inDialogs: true })
  useShortcut(SHORTCUTS.help, overlayShortcut('shortcuts'), { inDialogs: true })

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
      <ShortcutsDialog
        open={overlay === 'shortcuts'}
        onOpenChange={(open) => (open ? useUi.getState().show('shortcuts') : useUi.getState().close())}
      />
      <CommandPalette />
      <GoToDnDialog />
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
