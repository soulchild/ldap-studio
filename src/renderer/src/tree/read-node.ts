/**
 * Reads one entry as a tree node, for revealing an entry that its parent's loaded children do
 * not include (the server stopped early, e.g. at a size or permission limit).
 */
import type { TreeNode } from '@shared/ipc'

export async function readTreeNode(connectionId: string, dn: string): Promise<TreeNode | undefined> {
  const result = await window.api.invoke('entry.read', { connectionId, dn, includeOperational: false })
  if (!result.ok || !result.value) {
    return undefined
  }
  const objectClasses = (
    result.value.attributes.find((attribute) => attribute.name.toLowerCase() === 'objectclass')?.values ?? []
  ).filter((value): value is string => typeof value === 'string')
  return { dn: result.value.dn, objectClasses }
}
