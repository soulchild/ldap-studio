import { useConnections } from '@renderer/state/connections'
import { useLayout } from '@renderer/state/layout'
import { useSearch } from '@renderer/state/search'
import { useTree } from '@renderer/state/tree'

/**
 * Opens the search view (directory-search spec: default base from selection): the base is the
 * entry selected in the tree, or the tree's root.
 */
export function openSearch(): void {
  const connections = useConnections.getState()
  const state = connections.activeProfileId ? connections.states[connections.activeProfileId] : undefined
  if (state?.status === 'connected') {
    const tree = useTree.getState().trees[state.connectionId]
    const selected = useTree.getState().selected[state.connectionId]
    const node =
      (selected ? tree?.nodes[selected] : undefined) ??
      (tree ? tree.nodes[tree.rootKeys[0] ?? ''] : undefined)
    if (node) {
      useSearch.getState().setParams({ base: node.dn, scope: 'sub' })
    }
  }
  const focused = document.activeElement
  useLayout.getState().showBottomTab('search')
  // The search panel renders on the next frame when the panel was collapsed. Leave the focus
  // alone if the user has already moved it, e.g. into the base DN field.
  requestAnimationFrame(() => {
    if (document.activeElement === focused || document.activeElement === document.body) {
      document.getElementById('search-filter')?.focus()
    }
  })
}
