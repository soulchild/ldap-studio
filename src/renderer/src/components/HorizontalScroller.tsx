import { useEffect, useRef, useState, type ReactNode } from 'react'
import { cn } from '@renderer/lib/utils'

const FADE = '1rem'

/**
 * A single row that scrolls sideways without a visible scrollbar, so it keeps its height. The
 * edges fade where there is more to see, and a normal mouse wheel scrolls it too.
 */
export function HorizontalScroller({
  label,
  className,
  startAtEnd = false,
  children,
}: {
  label: string
  className?: string
  /** Starts scrolled to the end, such as for a path whose last segment matters most. */
  startAtEnd?: boolean
  children: ReactNode
}): React.JSX.Element {
  const list = useRef<HTMLUListElement>(null)
  const [edges, setEdges] = useState({ before: false, after: false })

  useEffect(() => {
    const element = list.current
    if (!element) {
      return
    }
    const measure = () => {
      const before = element.scrollLeft > 1
      const after = element.scrollLeft + element.clientWidth < element.scrollWidth - 1
      setEdges((current) =>
        current.before === before && current.after === after ? current : { before, after },
      )
    }
    // A vertical wheel scrolls the row sideways; React's own wheel handlers cannot prevent the
    // default, hence a native listener.
    const onWheel = (event: WheelEvent) => {
      if (Math.abs(event.deltaY) > Math.abs(event.deltaX) && element.scrollWidth > element.clientWidth) {
        const before = element.scrollLeft
        element.scrollLeft += event.deltaY
        if (element.scrollLeft !== before) {
          event.preventDefault()
        }
      }
    }
    const resize = new ResizeObserver(measure)
    resize.observe(element)
    element.addEventListener('scroll', measure, { passive: true })
    element.addEventListener('wheel', onWheel, { passive: false })
    if (startAtEnd) {
      element.scrollLeft = element.scrollWidth
    }
    measure()
    return () => {
      resize.disconnect()
      element.removeEventListener('scroll', measure)
      element.removeEventListener('wheel', onWheel)
    }
    // Only on mount: scrolling back to the end on every render would fight the user.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const mask =
    edges.before || edges.after
      ? `linear-gradient(to right, ${edges.before ? 'transparent' : 'black'} 0, black ${FADE}, black calc(100% - ${FADE}), ${edges.after ? 'transparent' : 'black'} 100%)`
      : undefined
  return (
    <ul
      ref={list}
      aria-label={label}
      data-overflowing={edges.before || edges.after ? true : undefined}
      className={cn('no-scrollbar flex min-w-0 overflow-x-auto', className)}
      style={mask ? { maskImage: mask } : undefined}
    >
      {children}
    </ul>
  )
}
