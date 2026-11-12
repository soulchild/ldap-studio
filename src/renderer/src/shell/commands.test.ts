import { describe, expect, it } from 'vitest'
import { matchCommands, type Command } from './commands'

const command = (id: string, title: string, group: Command['group'], keywords?: string): Command => ({
  id,
  title,
  group,
  ...(keywords ? { keywords } : {}),
  run: () => undefined,
})

const commands = [
  command('go-to-dn', 'Go to DN…', 'Navigate', 'lookup jump'),
  command('log', 'Show the operation log', 'Navigate', 'history'),
  command('delete', 'Delete entry…', 'Entry', 'remove'),
  command('theme-dark', 'Theme: dark', 'View', 'appearance'),
]

describe('matchCommands', () => {
  const ids = (query: string) => matchCommands(commands, query).map((item) => item.id)

  it('lists everything in order for an empty query', () => {
    expect(ids('  ')).toEqual(['go-to-dn', 'log', 'delete', 'theme-dark'])
  })

  it('needs every word, in the title, group or keywords, ignoring case', () => {
    expect(ids('DARK theme')).toEqual(['theme-dark'])
    expect(ids('remove')).toEqual(['delete'])
    expect(ids('entry delete')).toEqual(['delete'])
    expect(ids('jump nowhere')).toEqual([])
  })

  it('puts titles starting with the first word first, then titles containing it', () => {
    expect(ids('the')).toEqual(['theme-dark', 'log'])
  })
})
