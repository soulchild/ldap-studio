/**
 * Shows scrollbar thumbs only when needed, like macOS overlay scrollbars (styles.css draws them):
 * `is-scrolling` while an element scrolls and for a moment after, and `is-scrollbar-hovered`
 * while the pointer is near its scrollbar so the thumb can be grabbed. Chromium repaints custom
 * scrollbars on class changes but not on :hover alone, hence classes.
 */
const HIDE_AFTER_MS = 900
/** How close to the edge the pointer must be, in pixels: the scrollbar plus a little slack. */
const EDGE = 16

function scrollableEdgeAt(target: EventTarget | null, x: number, y: number): Element | undefined {
  let element = target instanceof Element ? target : null
  while (element && element !== document.body) {
    const vertical = element.scrollHeight > element.clientHeight
    const horizontal = element.scrollWidth > element.clientWidth
    if (vertical || horizontal) {
      const style = getComputedStyle(element)
      const scrolls = (value: string) => value === 'auto' || value === 'scroll'
      const box = element.getBoundingClientRect()
      if (
        (vertical && scrolls(style.overflowY) && x >= box.right - EDGE && x <= box.right) ||
        (horizontal && scrolls(style.overflowX) && y >= box.bottom - EDGE && y <= box.bottom)
      ) {
        return element
      }
    }
    element = element.parentElement
  }
  return undefined
}

export function showScrollbarsWhileScrolling(): void {
  const timers = new WeakMap<Element, number>()
  document.addEventListener(
    'scroll',
    (event) => {
      const element = event.target
      if (!(element instanceof Element)) {
        return
      }
      element.classList.add('is-scrolling')
      window.clearTimeout(timers.get(element))
      timers.set(
        element,
        window.setTimeout(() => element.classList.remove('is-scrolling'), HIDE_AFTER_MS),
      )
    },
    { capture: true, passive: true },
  )

  let hovered: Element | undefined
  let pending: PointerEvent | undefined
  const update = () => {
    const event = pending
    pending = undefined
    const next = event ? scrollableEdgeAt(event.target, event.clientX, event.clientY) : undefined
    if (next !== hovered) {
      hovered?.classList.remove('is-scrollbar-hovered')
      next?.classList.add('is-scrollbar-hovered')
      hovered = next
    }
  }
  document.addEventListener(
    'pointermove',
    (event) => {
      // At most one check per frame.
      if (!pending) {
        requestAnimationFrame(update)
      }
      pending = event
    },
    { passive: true },
  )
  document.documentElement.addEventListener('pointerleave', () => {
    pending = undefined
    update()
  })
}
