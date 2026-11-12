import { describe, expect, it } from 'vitest'
import { restorableBounds } from './window-state'

const screen = { x: 0, y: 0, width: 1920, height: 1080 }
const bounds = (x: number, y: number) => ({ x, y, width: 1200, height: 800, maximized: false })

describe('restorableBounds', () => {
  it('restores bounds that are on a connected display', () => {
    expect(restorableBounds(bounds(100, 100), [screen])).toEqual(bounds(100, 100))
  })

  it('drops bounds that are off every display, e.g. on a disconnected monitor', () => {
    expect(restorableBounds(bounds(2500, 100), [screen])).toBeUndefined()
  })

  it('keeps bounds that are mostly off-screen but still show enough to grab', () => {
    expect(restorableBounds(bounds(1700, 900), [screen])).toEqual(bounds(1700, 900))
    expect(restorableBounds(bounds(1850, 100), [screen])).toBeUndefined()
  })

  it('checks every display', () => {
    expect(
      restorableBounds(bounds(2500, 100), [screen, { x: 1920, y: 0, width: 2560, height: 1440 }]),
    ).toBeDefined()
  })

  it('returns nothing when nothing was saved', () => {
    expect(restorableBounds(undefined, [screen])).toBeUndefined()
  })
})
