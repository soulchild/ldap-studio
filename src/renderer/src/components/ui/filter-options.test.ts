import { describe, expect, it } from 'vitest'
import { filterOptions } from './filter-options'

describe('filterOptions', () => {
  const options = ['cn', 'description', 'displayName', 'mail', 'telephoneNumber', 'title']

  it('lists everything for empty text', () => {
    expect(filterOptions(options, ' ')).toEqual(options)
  })

  it('matches anywhere, ignoring case, with prefix matches first', () => {
    expect(filterOptions(options, 'Ti')).toEqual(['title', 'description'])
  })

  it('returns nothing when nothing matches', () => {
    expect(filterOptions(options, 'xyz')).toEqual([])
  })
})
