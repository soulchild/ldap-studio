import { showInTree, useEditor } from '@renderer/state/editor'
import { useTree } from '@renderer/state/tree'
import { keyOf } from '@renderer/tree/model'
import { isDescendantOf, parentDn, parseDn, parseDnStrict, serializeDn, serializeRdn } from '@shared/dn'

export function parentOf(dn: string): string {
  return serializeDn(parentDn(parseDnStrict(dn)) ?? [])
}

export function rdnOf(dn: string): string {
  return serializeRdn(parseDnStrict(dn)[0] ?? [])
}

/** The attribute type and value of a single-valued RDN such as `uid=jdoe`. */
export function splitRdn(rdn: string): { attribute: string; value: string } | undefined {
  const parsed = parseDn(rdn)
  const ava = parsed.ok && parsed.dn.length === 1 && parsed.dn[0]?.length === 1 ? parsed.dn[0][0] : undefined
  return ava && !ava.isHex ? { attribute: ava.type, value: ava.value } : undefined
}

/** True when `dn` is `ancestor` itself or below it. */
export function isWithin(dn: string, ancestor: string): boolean {
  const a = parseDn(dn)
  const b = parseDn(ancestor)
  if (!a.ok || !b.ok) {
    return false
  }
  return keyOf(dn) === keyOf(ancestor) || isDescendantOf(a.dn, b.dn)
}

/** After a rename or move: refresh the old parent and show the entry under its new DN. */
export async function afterRelocation(connectionId: string, oldDn: string, newDn: string): Promise<void> {
  const tree = useTree.getState()
  const oldParentKey = keyOf(parentOf(oldDn))
  if (tree.trees[connectionId]?.nodes[oldParentKey]) {
    tree.refresh(connectionId, oldParentKey)
  }
  const editor = useEditor.getState()
  if (editor.entry && editor.entry.connectionId === connectionId && isWithin(editor.entry.dn, oldDn)) {
    await editor.open(connectionId, newDn)
  }
  await showInTree(connectionId, newDn)
}
