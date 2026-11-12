/**
 * The directory tree of one connection (directory-tree spec, design §10). Nodes are immutable
 * and keyed by normalized DN. Changing a node replaces it and its ancestors, so the flattened
 * list of visible rows can be cached per node object and only the changed path is recomputed.
 */
import { normalizeDn, parseDn, serializeRdn } from '@shared/dn'
import type { TreeNode as LoadedNode } from '@shared/ipc'

export interface TreeNode {
  key: string
  /** The DN as the server returned it; used for operations. */
  dn: string
  /** The node's own RDN, for display. */
  rdn: string
  parentKey: string | undefined
  depth: number
  objectClasses: string[]
  /** False once known to be a leaf; undefined until known. */
  hasChildren: boolean | undefined
  expanded: boolean
  /** Undefined until the children were loaded once. */
  childKeys: string[] | undefined
  loading: boolean
  /** Waiting behind another paged operation on the connection. */
  queued: boolean
  /** The list of children is known to be partial. */
  incomplete: boolean
  error: string | undefined
  /** Text the loaded children are filtered by; '' shows all. */
  filter: string
  filterOpen: boolean
}

export interface Tree {
  nodes: Record<string, TreeNode>
  rootKeys: string[]
}

export type TreeRow =
  | { kind: 'node'; key: string; depth: number }
  | { kind: 'filter'; key: string; depth: number }
  | { kind: 'loading'; key: string; depth: number }
  | { kind: 'incomplete'; key: string; depth: number }
  | { kind: 'error'; key: string; depth: number }
  | { kind: 'filtered-out'; key: string; depth: number }

/** Containers with at least this many children get a filter field automatically. */
export const AUTO_FILTER_THRESHOLD = 200

export function keyOf(dn: string): string {
  try {
    return normalizeDn(dn)
  } catch {
    return dn.toLowerCase()
  }
}

function rdnOf(dn: string): string {
  const parsed = parseDn(dn)
  const first = parsed.ok ? parsed.dn[0] : undefined
  return first ? serializeRdn(first) : dn
}

function makeNode(dn: string, parentKey: string | undefined, depth: number, loaded?: LoadedNode): TreeNode {
  return {
    key: keyOf(dn),
    dn,
    rdn: depth === 0 ? dn : rdnOf(dn),
    parentKey,
    depth,
    objectClasses: loaded?.objectClasses ?? [],
    hasChildren: loaded?.hasChildren,
    expanded: false,
    childKeys: undefined,
    loading: false,
    queued: false,
    incomplete: false,
    error: undefined,
    filter: '',
    filterOpen: false,
  }
}

export function createTree(rootDns: string[]): Tree {
  const nodes: Record<string, TreeNode> = {}
  const rootKeys: string[] = []
  for (const dn of rootDns) {
    const node = makeNode(dn, undefined, 0)
    if (!nodes[node.key]) {
      nodes[node.key] = node
      rootKeys.push(node.key)
    }
  }
  return { nodes, rootKeys }
}

/** Replaces a node and copies its ancestors, so cached rows of the whole path are invalidated. */
export function updateNode(tree: Tree, key: string, change: (node: TreeNode) => Partial<TreeNode>): Tree {
  const node = tree.nodes[key]
  if (!node) {
    return tree
  }
  const nodes = { ...tree.nodes, [key]: { ...node, ...change(node) } }
  let parentKey = node.parentKey
  while (parentKey !== undefined) {
    const parent = nodes[parentKey]
    if (!parent) {
      break
    }
    nodes[parentKey] = { ...parent }
    parentKey = parent.parentKey
  }
  return { ...tree, nodes }
}

/** Starts (or restarts) loading a node's children: the old children are discarded. */
export function startLoading(tree: Tree, key: string): Tree {
  const removed = new Set(descendantKeys(tree, key))
  const nodes = Object.fromEntries(
    Object.entries(tree.nodes).filter(([candidate]) => !removed.has(candidate)),
  )
  return updateNode({ ...tree, nodes }, key, () => ({
    childKeys: [],
    loading: true,
    queued: false,
    incomplete: false,
    error: undefined,
  }))
}

export function markQueued(tree: Tree, key: string): Tree {
  return updateNode(tree, key, () => ({ queued: true }))
}

/** Adds a page of children in server order. */
export function appendChildren(tree: Tree, key: string, loaded: LoadedNode[]): Tree {
  const parent = tree.nodes[key]
  if (!parent) {
    return tree
  }
  const nodes = { ...tree.nodes }
  const known = new Set(parent.childKeys ?? [])
  const added: string[] = []
  for (const item of loaded) {
    const child = makeNode(item.dn, key, parent.depth + 1, item)
    if (!known.has(child.key)) {
      known.add(child.key)
      added.push(child.key)
      nodes[child.key] = child
    }
  }
  return updateNode({ ...tree, nodes }, key, (node) => ({
    childKeys: [...(node.childKeys ?? []), ...added],
    queued: false,
  }))
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

/** Ends loading; children are sorted by their RDN once complete, so rows do not jump while pages arrive. */
export function finishLoading(tree: Tree, key: string, incomplete: boolean): Tree {
  return updateNode(tree, key, (node) => {
    const childKeys = [...(node.childKeys ?? [])].sort((a, b) =>
      collator.compare(tree.nodes[a]?.rdn ?? a, tree.nodes[b]?.rdn ?? b),
    )
    return {
      childKeys,
      loading: false,
      queued: false,
      incomplete,
      hasChildren: childKeys.length > 0 ? true : incomplete ? node.hasChildren : false,
      filterOpen: node.filterOpen || childKeys.length >= AUTO_FILTER_THRESHOLD,
    }
  })
}

export function failLoading(tree: Tree, key: string, message: string): Tree {
  return updateNode(tree, key, () => ({ loading: false, queued: false, error: message }))
}

export function setExpanded(tree: Tree, key: string, expanded: boolean): Tree {
  return updateNode(tree, key, () => ({ expanded }))
}

export function setFilter(tree: Tree, key: string, filter: string): Tree {
  return updateNode(tree, key, () => ({ filter, filterOpen: true }))
}

export function closeFilter(tree: Tree, key: string): Tree {
  return updateNode(tree, key, (node) => ({
    filter: '',
    filterOpen: (node.childKeys?.length ?? 0) >= AUTO_FILTER_THRESHOLD,
  }))
}

export function descendantKeys(tree: Tree, key: string): string[] {
  const result: string[] = []
  const pending = [...(tree.nodes[key]?.childKeys ?? [])]
  while (pending.length > 0) {
    const next = pending.pop() as string
    result.push(next)
    pending.push(...(tree.nodes[next]?.childKeys ?? []))
  }
  return result
}

export function matchesFilter(node: TreeNode, filter: string): boolean {
  return filter === '' || node.rdn.toLowerCase().includes(filter.toLowerCase())
}

const rowCache = new WeakMap<TreeNode, TreeRow[]>()

/** Rows for a node and its visible descendants. Cached per node object (see updateNode). */
function subtreeRows(tree: Tree, node: TreeNode): TreeRow[] {
  const cached = rowCache.get(node)
  if (cached) {
    return cached
  }
  const rows: TreeRow[] = [{ kind: 'node', key: node.key, depth: node.depth }]
  if (node.expanded) {
    const depth = node.depth + 1
    if (node.filterOpen) {
      rows.push({ kind: 'filter', key: node.key, depth })
    }
    const children = node.childKeys ?? []
    let shown = 0
    for (const childKey of children) {
      const child = tree.nodes[childKey]
      if (child && matchesFilter(child, node.filter)) {
        shown++
        for (const row of subtreeRows(tree, child)) {
          rows.push(row)
        }
      }
    }
    if (node.filter !== '' && shown === 0 && children.length > 0) {
      rows.push({ kind: 'filtered-out', key: node.key, depth })
    }
    if (node.loading) {
      rows.push({ kind: 'loading', key: node.key, depth })
    } else if (node.error !== undefined) {
      rows.push({ kind: 'error', key: node.key, depth })
    } else if (node.incomplete) {
      rows.push({ kind: 'incomplete', key: node.key, depth })
    }
  }
  rowCache.set(node, rows)
  return rows
}

/** The visible rows of the whole tree, top to bottom. */
export function flatten(tree: Tree): TreeRow[] {
  const rows: TreeRow[] = []
  for (const key of tree.rootKeys) {
    const root = tree.nodes[key]
    if (root) {
      for (const row of subtreeRows(tree, root)) {
        rows.push(row)
      }
    }
  }
  return rows
}

/** Whether a node can be expanded: unknown counts as yes until loading proves otherwise. */
export function isExpandable(node: TreeNode): boolean {
  return node.hasChildren !== false
}
