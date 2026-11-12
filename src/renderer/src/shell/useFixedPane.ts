import { useEffect, useRef, type RefObject } from 'react'
import type { GroupImperativeHandle, Layout, LayoutChangedMeta } from 'react-resizable-panels'

interface FixedPaneOptions {
  groupRef: RefObject<GroupImperativeHandle | null>
  elementRef: RefObject<HTMLDivElement | null>
  axis: 'horizontal' | 'vertical'
  /** The pane that keeps its pixel size. */
  fixedId: string
  /** The pane that takes up the rest. */
  flexibleId: string
  /** Pixel size to start with. */
  initialSize: number
  /** Called with the new pixel size after the user resizes the pane. */
  onUserResize: (pixels: number) => void
  /** Overrides the pixel size while active, e.g. a collapsed panel's bar height. */
  overrideSize?: number | undefined
}

/**
 * Keeps one pane of a two-pane group at a fixed pixel size when the window is resized, and
 * reports when the user drags it to a new size. (react-resizable-panels' own
 * `preserve-pixel-size` did not hold the size in this app; see design.md Risks.)
 */
export function useFixedPane(options: FixedPaneOptions): (layout: Layout, meta: LayoutChangedMeta) => void {
  const desired = useRef(options.initialSize)
  const latest = useRef(options)
  useEffect(() => {
    latest.current = options
  })

  const apply = () => {
    const { groupRef, elementRef, axis, fixedId, flexibleId, overrideSize } = latest.current
    const element = elementRef.current
    const group = groupRef.current
    if (!element || !group) {
      return
    }
    const total = axis === 'horizontal' ? element.clientWidth : element.clientHeight
    if (total <= 0) {
      return
    }
    const pixels = overrideSize ?? desired.current
    const percent = Math.min(Math.max((pixels / total) * 100, 0), 100)
    group.setLayout({ [fixedId]: percent, [flexibleId]: 100 - percent })
  }

  useEffect(() => {
    const element = options.elementRef.current
    if (!element) {
      return
    }
    apply()
    const observer = new ResizeObserver(() => apply())
    observer.observe(element)
    return () => observer.disconnect()
    // The observer reads the latest options through the ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Apply again when the override starts or stops, e.g. on collapse and expand.
  useEffect(() => {
    apply()
  }, [options.overrideSize])

  return (layout, meta) => {
    if (!meta.isUserInteraction) {
      return
    }
    const { elementRef, axis, fixedId, overrideSize, onUserResize } = latest.current
    const element = elementRef.current
    const percent = layout[fixedId]
    if (!element || percent === undefined || overrideSize !== undefined) {
      return
    }
    const total = axis === 'horizontal' ? element.clientWidth : element.clientHeight
    desired.current = Math.round((percent / 100) * total)
    onUserResize(desired.current)
  }
}
