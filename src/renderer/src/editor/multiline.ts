/** Line breaks in text values (entry-editing spec: multi-line text values, line breaks are preserved). */

export type LineBreakStyle = 'lf' | 'crlf'

/** Multi-line values show at most this many lines before they scroll. */
export const MAX_VISIBLE_LINES = 5

const LINE_BREAK = /\r\n|\r|\n/

/** Whether the value has a line break of any kind, so it needs a multi-line field. */
export function isMultiline(value: string): boolean {
  return LINE_BREAK.test(value)
}

/** The number of lines a text area shows, counting the empty line after a trailing break. */
export function lineCount(value: string): number {
  return value.split(LINE_BREAK).length
}

/** CR LF if the value uses it anywhere, otherwise LF. */
export function lineBreakStyle(value: string): LineBreakStyle {
  return value.includes('\r\n') ? 'crlf' : 'lf'
}

/** Text from a text area, whose line breaks are always LF, with the value's own style put back. */
export function withLineBreaks(text: string, style: LineBreakStyle): string {
  return style === 'crlf' ? text.replace(/\r?\n/g, '\r\n') : text
}
