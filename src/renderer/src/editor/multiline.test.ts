import { describe, expect, it } from 'vitest'
import { isMultiline, lineBreakStyle, lineCount, withLineBreaks } from './multiline'

describe('isMultiline', () => {
  it('is true for any line break, false otherwise', () => {
    expect(isMultiline('one line')).toBe(false)
    expect(isMultiline('')).toBe(false)
    expect(isMultiline('foo:\n  - bar')).toBe(true)
    expect(isMultiline('foo:\r\n  - bar')).toBe(true)
    expect(isMultiline('old mac\rline')).toBe(true)
  })
})

describe('lineCount', () => {
  it('counts lines split at LF, CR LF and CR', () => {
    expect(lineCount('')).toBe(1)
    expect(lineCount('one line')).toBe(1)
    expect(lineCount('a\nb\nc')).toBe(3)
    expect(lineCount('a\r\nb')).toBe(2)
    expect(lineCount('a\rb')).toBe(2)
  })

  it('counts the empty line after a trailing line break, as a text area shows it', () => {
    expect(lineCount('a\n')).toBe(2)
    expect(lineCount('a\r\n')).toBe(2)
  })
})

describe('lineBreakStyle', () => {
  it('is CR LF when the value has one, LF otherwise', () => {
    expect(lineBreakStyle('a\r\nb')).toBe('crlf')
    expect(lineBreakStyle('a\nb')).toBe('lf')
    expect(lineBreakStyle('one line')).toBe('lf')
    expect(lineBreakStyle('')).toBe('lf')
  })
})

describe('withLineBreaks', () => {
  it('turns the LF a text area gives back into CR LF', () => {
    expect(withLineBreaks('a\nb\n', 'crlf')).toBe('a\r\nb\r\n')
  })

  it('does not double existing CR LF', () => {
    expect(withLineBreaks('a\r\nb', 'crlf')).toBe('a\r\nb')
  })

  it('leaves text unchanged for LF', () => {
    expect(withLineBreaks('a\nb', 'lf')).toBe('a\nb')
    expect(withLineBreaks('one line', 'lf')).toBe('one line')
  })
})
