import { describe, expect, it } from 'vitest'
import {
  appendChildren,
  AUTO_FILTER_THRESHOLD,
  closeFilter,
  createTree,
  failLoading,
  finishLoading,
  flatten,
  isExpandable,
  keyOf,
  markQueued,
  setExpanded,
  setFilter,
  startLoading,
  type Tree,
} from './model'

const ROOT = 'dc=example,dc=com'
const node = (dn: string, hasChildren?: boolean) => ({ dn, objectClasses: ['top'], hasChildren })
const rows = (tree: Tree) =>
  flatten(tree).map((row) => `${'  '.repeat(row.depth)}${row.kind}:${tree.nodes[row.key]?.rdn}`)

function expandedRoot(): Tree {
  let tree = createTree([ROOT])
  tree = setExpanded(tree, keyOf(ROOT), true)
  tree = startLoading(tree, keyOf(ROOT))
  return tree
}

describe('tree model', () => {
  it('shows collapsed roots by their full DN', () => {
    const tree = createTree([ROOT, 'o=other'])
    expect(rows(tree)).toEqual(['node:dc=example,dc=com', 'node:o=other'])
    expect(isExpandable(tree.nodes[keyOf(ROOT)]!)).toBe(true)
  })

  it('shows a loading row while children stream in, in server order', () => {
    let tree = expandedRoot()
    expect(rows(tree)).toEqual(['node:dc=example,dc=com', '  loading:dc=example,dc=com'])
    tree = appendChildren(tree, keyOf(ROOT), [node(`ou=people,${ROOT}`), node(`ou=groups,${ROOT}`)])
    tree = appendChildren(tree, keyOf(ROOT), [node(`ou=bulk,${ROOT}`)])
    expect(rows(tree)).toEqual([
      'node:dc=example,dc=com',
      '  node:ou=people',
      '  node:ou=groups',
      '  node:ou=bulk',
      '  loading:dc=example,dc=com',
    ])
  })

  it('sorts children by name when loading finishes and ignores duplicates', () => {
    let tree = expandedRoot()
    tree = appendChildren(tree, keyOf(ROOT), [node(`cn=user10,${ROOT}`), node(`cn=user9,${ROOT}`)])
    tree = appendChildren(tree, keyOf(ROOT), [node(`CN=User9,${ROOT}`)])
    tree = finishLoading(tree, keyOf(ROOT), false)
    expect(rows(tree)).toEqual(['node:dc=example,dc=com', '  node:cn=user9', '  node:cn=user10'])
  })

  it('marks a node without children as a leaf once loaded', () => {
    let tree = expandedRoot()
    tree = finishLoading(tree, keyOf(ROOT), false)
    expect(tree.nodes[keyOf(ROOT)]!.hasChildren).toBe(false)
    expect(isExpandable(tree.nodes[keyOf(ROOT)]!)).toBe(false)
  })

  it('collapses and re-expands without losing loaded children', () => {
    let tree = expandedRoot()
    tree = appendChildren(tree, keyOf(ROOT), [node(`ou=people,${ROOT}`)])
    tree = finishLoading(tree, keyOf(ROOT), false)
    tree = setExpanded(tree, keyOf(ROOT), false)
    expect(rows(tree)).toEqual(['node:dc=example,dc=com'])
    tree = setExpanded(tree, keyOf(ROOT), true)
    expect(rows(tree)).toEqual(['node:dc=example,dc=com', '  node:ou=people'])
  })

  it('shows nested expanded nodes at their depth', () => {
    let tree = expandedRoot()
    tree = appendChildren(tree, keyOf(ROOT), [node(`ou=people,${ROOT}`)])
    tree = finishLoading(tree, keyOf(ROOT), false)
    const people = keyOf(`ou=people,${ROOT}`)
    tree = setExpanded(tree, people, true)
    tree = startLoading(tree, people)
    tree = appendChildren(tree, people, [node(`uid=jdoe,ou=people,${ROOT}`, false)])
    tree = finishLoading(tree, people, false)
    expect(flatten(tree).map((row) => row.depth)).toEqual([0, 1, 2])
    expect(rows(tree)[2]).toBe('    node:uid=jdoe')
  })

  it('shows incomplete, queued and error states', () => {
    let tree = expandedRoot()
    tree = markQueued(tree, keyOf(ROOT))
    expect(tree.nodes[keyOf(ROOT)]!.queued).toBe(true)
    tree = appendChildren(tree, keyOf(ROOT), [node(`ou=a,${ROOT}`)])
    expect(tree.nodes[keyOf(ROOT)]!.queued).toBe(false)
    tree = finishLoading(tree, keyOf(ROOT), true)
    expect(rows(tree).at(-1)).toBe('  incomplete:dc=example,dc=com')
    tree = startLoading(tree, keyOf(ROOT))
    tree = failLoading(tree, keyOf(ROOT), 'No such entry exists.')
    expect(rows(tree)).toEqual(['node:dc=example,dc=com', '  error:dc=example,dc=com'])
  })

  it('reloading discards the old children and their descendants', () => {
    let tree = expandedRoot()
    tree = appendChildren(tree, keyOf(ROOT), [node(`ou=people,${ROOT}`)])
    tree = finishLoading(tree, keyOf(ROOT), false)
    const people = keyOf(`ou=people,${ROOT}`)
    tree = startLoading(setExpanded(tree, people, true), people)
    tree = appendChildren(tree, people, [node(`uid=a,ou=people,${ROOT}`)])
    tree = startLoading(tree, keyOf(ROOT))
    expect(tree.nodes[people]).toBeUndefined()
    expect(tree.nodes[keyOf(`uid=a,ou=people,${ROOT}`)]).toBeUndefined()
  })

  describe('filtering children', () => {
    function withPeople(): Tree {
      let tree = expandedRoot()
      tree = appendChildren(tree, keyOf(ROOT), [
        node(`uid=jdoe,${ROOT}`),
        node(`uid=JDOE2,${ROOT}`),
        node(`uid=asmith,${ROOT}`),
      ])
      return finishLoading(tree, keyOf(ROOT), false)
    }

    it('shows only children whose RDN contains the text, ignoring case', () => {
      const tree = setFilter(withPeople(), keyOf(ROOT), 'jdo')
      expect(rows(tree)).toEqual([
        'node:dc=example,dc=com',
        '  filter:dc=example,dc=com',
        '  node:uid=jdoe',
        '  node:uid=JDOE2',
      ])
    })

    it('says so when nothing matches, and shows all again when closed', () => {
      let tree = setFilter(withPeople(), keyOf(ROOT), 'zzz')
      expect(rows(tree).at(-1)).toBe('  filtered-out:dc=example,dc=com')
      tree = closeFilter(tree, keyOf(ROOT))
      expect(rows(tree)).toHaveLength(4)
    })

    it(`opens the filter automatically for ${AUTO_FILTER_THRESHOLD} or more children`, () => {
      let tree = expandedRoot()
      tree = appendChildren(
        tree,
        keyOf(ROOT),
        Array.from({ length: AUTO_FILTER_THRESHOLD }, (_, i) => node(`cn=u${i},${ROOT}`)),
      )
      tree = finishLoading(tree, keyOf(ROOT), false)
      expect(rows(tree)[1]).toBe('  filter:dc=example,dc=com')
    })
  })

  describe('incremental flattening', () => {
    it('reuses the rows of untouched subtrees when another node changes', () => {
      let tree = expandedRoot()
      tree = appendChildren(tree, keyOf(ROOT), [node(`ou=a,${ROOT}`), node(`ou=b,${ROOT}`)])
      tree = finishLoading(tree, keyOf(ROOT), false)
      flatten(tree)
      const untouched = tree.nodes[keyOf(`ou=a,${ROOT}`)]
      const next = setExpanded(tree, keyOf(`ou=b,${ROOT}`), true)
      expect(next.nodes[keyOf(`ou=a,${ROOT}`)]).toBe(untouched)
      expect(next.nodes[keyOf(ROOT)]).not.toBe(tree.nodes[keyOf(ROOT)])
    })

    it('flattens 100,000 children quickly and keeps the result correct', () => {
      let tree = expandedRoot()
      const pages = 200
      for (let page = 0; page < pages; page++) {
        tree = appendChildren(
          tree,
          keyOf(ROOT),
          Array.from({ length: 500 }, (_, i) => node(`cn=user${page * 500 + i},${ROOT}`)),
        )
      }
      tree = finishLoading(tree, keyOf(ROOT), false)
      const started = performance.now()
      const result = flatten(tree)
      const elapsed = performance.now() - started
      expect(result).toHaveLength(100_000 + 2)
      expect(elapsed).toBeLessThan(250)
    })
  })
})
