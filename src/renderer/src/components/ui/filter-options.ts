/** At most this many suggestions are listed. */
const MAX_SHOWN = 200

/** Options containing the text, ignoring case; those starting with it first. */
export function filterOptions(options: readonly string[], text: string): string[] {
  const needle = text.trim().toLowerCase()
  if (needle === '') {
    return options.slice(0, MAX_SHOWN)
  }
  const starts: string[] = []
  const contains: string[] = []
  for (const option of options) {
    const index = option.toLowerCase().indexOf(needle)
    if (index === 0) {
      starts.push(option)
    } else if (index > 0) {
      contains.push(option)
    }
  }
  return [...starts, ...contains].slice(0, MAX_SHOWN)
}
