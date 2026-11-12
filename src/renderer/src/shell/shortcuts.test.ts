import { describe, expect, it } from 'vitest'
import { isMac, matches, SHORTCUTS } from './shortcuts'

function press(key: string, modifiers: { shift?: boolean; alt?: boolean; other?: boolean } = {}) {
  const primary = !modifiers.other
  return {
    key,
    metaKey: isMac ? primary : modifiers.other === true,
    ctrlKey: isMac ? modifiers.other === true : primary,
    shiftKey: modifiers.shift ?? false,
    altKey: modifiers.alt ?? false,
  } as KeyboardEvent
}

describe('matches', () => {
  it('matches the platform modifier with the key, ignoring case', () => {
    expect(matches(press('f'), SHORTCUTS.search)).toBe(true)
    expect(matches(press('F'), SHORTCUTS.search)).toBe(true)
  })

  it('rejects the other platform modifier, Alt, and unexpected Shift on letters', () => {
    expect(matches(press('f', { other: true }), SHORTCUTS.search)).toBe(false)
    expect(matches(press('f', { alt: true }), SHORTCUTS.search)).toBe(false)
    expect(matches(press('f', { shift: true }), SHORTCUTS.search)).toBe(false)
  })

  it('requires Shift where the shortcut declares it', () => {
    expect(matches(press('Backspace', { shift: true }), SHORTCUTS.discard)).toBe(true)
    expect(matches(press('Backspace'), SHORTCUTS.discard)).toBe(false)
  })

  it('accepts "/" typed with Shift, as on German keyboards', () => {
    expect(matches(press('/'), SHORTCUTS.help)).toBe(true)
    expect(matches(press('/', { shift: true }), SHORTCUTS.help)).toBe(true)
  })
})
