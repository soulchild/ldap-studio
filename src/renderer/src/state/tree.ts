/**
 * Directory trees, one per open connection (directory-tree spec). Expanding a node streams its
 * children from main; collapsing it while loading cancels the stream.
 */
import { create } from 'zustand'
import { readTreeNode } from '@renderer/tree/read-node'
import { ancestorsOf, parseDnStrict, serializeDn } from '@shared/dn'
import {
  appendChildren,
  createTree,
  descendantKeys,
  failLoading,
  finishLoading,
  isExpandable,
  keyOf,
  markQueued,
  setExpanded,
  startLoading,
  type Tree,
} from '@renderer/tree/model'

interface TreeStore {
  trees: Record<string, Tree>
  selected: Record<string, string | undefined>
  init: (connectionId: string, rootDns: string[]) => void
  drop: (connectionId: string) => void
  expand: (connectionId: string, key: string) => void
  collapse: (connectionId: string, key: string) => void
  toggle: (connectionId: string, key: string) => void
  refresh: (connectionId: string, key: string) => void
  cancel: (connectionId: string, key: string) => void
  select: (connectionId: string, key: string | undefined) => void
  /** Expands the path from its root to `dn` and selects it; false if `dn` is not below a root. */
  reveal: (connectionId: string, dn: string) => Promise<boolean>
}

/** Running loads by connection and node, to cancel them. */
const loads = new Map<string, () => void>()
/** The latest load generation per connection and node. */
const generations = new Map<string, number>()
/** Nodes to expand again once they reappear after a refresh. */
const reopen = new Map<string, Set<string>>()
const loadId = (connectionId: string, key: string) => `${connectionId}\u0000${key}`

export const useTree = create<TreeStore>((set, get) => {
  const change = (connectionId: string, update: (tree: Tree) => Tree) =>
    set((store) => {
      const tree = store.trees[connectionId]
      return tree ? { trees: { ...store.trees, [connectionId]: update(tree) } } : {}
    })

  const load = (connectionId: string, key: string) => {
    const node = get().trees[connectionId]?.nodes[key]
    if (!node) {
      return
    }
    const id = loadId(connectionId, key)
    // A reload replaces a running load. The old load's late events (such as its
    // "cancelled" end) must not touch the node, so each load has its own generation.
    loads.get(id)?.()
    const generation = (generations.get(id) ?? 0) + 1
    generations.set(id, generation)
    const current = () => generations.get(id) === generation
    change(connectionId, (tree) => startLoading(tree, key))

    let finished = false
    const finish = () => {
      finished = true
      if (current()) {
        loads.delete(id)
      }
    }
    let cancelStream: (() => void) | undefined
    let cancelRequested = false
    loads.set(id, () => {
      cancelRequested = true
      cancelStream?.()
    })

    void window.api
      .stream('tree.children', { connectionId, dn: node.dn }, (event) => {
        if (finished || !current()) {
          return
        }
        switch (event.kind) {
          case 'page':
            change(connectionId, (tree) => appendChildren(tree, key, event.data.nodes))
            break
          case 'progress':
            if (event.data.queued) {
              change(connectionId, (tree) => markQueued(tree, key))
            }
            break
          case 'done':
            finish()
            change(connectionId, (tree) => finishLoading(tree, key, event.data.incomplete))
            reopenChildren(connectionId, key)
            break
          case 'error':
            finish()
            change(connectionId, (tree) =>
              event.error.kind === 'cancelled'
                ? finishLoading(tree, key, true)
                : failLoading(tree, key, event.error.message),
            )
            break
        }
      })
      .then((started) => {
        cancelStream = started.cancel
        if (cancelRequested) {
          started.cancel()
        }
      })
      .catch((error: { message?: string }) => {
        if (!current()) {
          return
        }
        finish()
        change(connectionId, (tree) =>
          failLoading(tree, key, error.message ?? 'The children could not be loaded.'),
        )
      })
  }

  const reopenChildren = (connectionId: string, key: string) => {
    const pending = reopen.get(connectionId)
    const tree = get().trees[connectionId]
    if (!pending || !tree) {
      return
    }
    for (const childKey of tree.nodes[key]?.childKeys ?? []) {
      if (pending.delete(childKey)) {
        get().expand(connectionId, childKey)
      }
    }
  }

  return {
    trees: {},
    selected: {},

    init(connectionId, rootDns) {
      set((store) => ({ trees: { ...store.trees, [connectionId]: createTree(rootDns) } }))
    },

    drop(connectionId) {
      for (const [id, cancel] of loads) {
        if (id.startsWith(`${connectionId}\u0000`)) {
          cancel()
          loads.delete(id)
        }
      }
      reopen.delete(connectionId)
      set((store) => {
        const { [connectionId]: _tree, ...trees } = store.trees
        const { [connectionId]: _selected, ...selected } = store.selected
        return { trees, selected }
      })
    },

    expand(connectionId, key) {
      const node = get().trees[connectionId]?.nodes[key]
      if (!node || !isExpandable(node)) {
        return
      }
      change(connectionId, (tree) => setExpanded(tree, key, true))
      if (node.childKeys === undefined || node.error !== undefined || (node.incomplete && !node.loading)) {
        load(connectionId, key)
      }
    },

    collapse(connectionId, key) {
      change(connectionId, (tree) => setExpanded(tree, key, false))
      get().cancel(connectionId, key)
    },

    toggle(connectionId, key) {
      const node = get().trees[connectionId]?.nodes[key]
      if (node?.expanded) {
        get().collapse(connectionId, key)
      } else {
        get().expand(connectionId, key)
      }
    },

    refresh(connectionId, key) {
      const tree = get().trees[connectionId]
      if (!tree?.nodes[key]) {
        return
      }
      const expandedBelow = descendantKeys(tree, key).filter((candidate) => tree.nodes[candidate]?.expanded)
      const pending = reopen.get(connectionId) ?? new Set<string>()
      expandedBelow.forEach((candidate) => pending.add(candidate))
      reopen.set(connectionId, pending)
      change(connectionId, (current) => setExpanded(current, key, true))
      load(connectionId, key)
    },

    cancel(connectionId, key) {
      loads.get(loadId(connectionId, key))?.()
    },

    select(connectionId, key) {
      set((store) => ({ selected: { ...store.selected, [connectionId]: key } }))
    },

    async reveal(connectionId, dn) {
      const tree = get().trees[connectionId]
      if (!tree) {
        return false
      }
      const target = parseDnStrict(dn)
      const path = [...ancestorsOf(target), target].map((part) => keyOf(serializeDn(part)))
      const start = path.findIndex((key) => tree.rootKeys.includes(key))
      if (start === -1) {
        return false
      }
      const dns = [...ancestorsOf(target), target].map((part) => serializeDn(part))
      for (let index = start; index < path.length - 1; index++) {
        const key = path[index] as string
        if (!get().trees[connectionId]?.nodes[key]?.expanded) {
          get().expand(connectionId, key)
        }
        const loaded = await waitFor(() => {
          const node = get().trees[connectionId]?.nodes[key]
          return node !== undefined && !node.loading
        })
        if (!loaded) {
          return false
        }
        // The next level shows up once its parent's children have loaded, unless the server
        // stopped before it: then read it directly and add it.
        const nextKey = path[index + 1] as string
        if (!get().trees[connectionId]?.nodes[nextKey]) {
          const next = await readTreeNode(connectionId, dns[index + 1] as string)
          if (!next) {
            return false
          }
          change(connectionId, (current) => appendChildren(current, key, [next]))
        }
      }
      const targetKey = path.at(-1) as string
      if (!get().trees[connectionId]?.nodes[targetKey]) {
        return false
      }
      get().select(connectionId, targetKey)
      return true
    },
  }

  /** Resolves true once `predicate` holds for the store, or false after `timeoutMs`. */
  function waitFor(predicate: () => boolean, timeoutMs = 60_000): Promise<boolean> {
    if (predicate()) {
      return Promise.resolve(true)
    }
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        unsubscribe()
        resolve(false)
      }, timeoutMs)
      const unsubscribe = useTree.subscribe(() => {
        if (predicate()) {
          clearTimeout(timer)
          unsubscribe()
          resolve(true)
        }
      })
    })
  }
})
