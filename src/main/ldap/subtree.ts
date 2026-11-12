/**
 * Counting and deleting whole subtrees (entry-editing spec: delete subtree, progress and failure).
 * Listing goes through the session's paged queue; deletes are single operations.
 */
import { Control } from 'ldapts'
import { parseDnStrict } from '@shared/dn'
import type { AppError } from '@shared/ipc'
import { toAppError } from './errors'
import type { LdapSession } from './session'

/** Active Directory's Tree Delete control: the server deletes the entry and everything below it. */
export const TREE_DELETE_OID = '1.2.840.113556.1.4.805'

export class TreeDeleteControl extends Control {
  constructor() {
    super(TREE_DELETE_OID, { critical: true })
  }
}

export interface SubtreeCount {
  /** Entries in the subtree, the base entry included. */
  count: number
  /** True when the listing stopped early (a server limit), so `count` is a lower bound. */
  incomplete: boolean
}

/** Lists every DN in the subtree, the base included. */
async function listSubtree(
  session: LdapSession,
  dn: string,
  signal: AbortSignal | undefined,
): Promise<{ dns: string[]; incomplete: boolean; cancelled: boolean }> {
  const dns: string[] = []
  const result = await session.search(
    { base: dn, scope: 'sub', filter: '(objectClass=*)', attributes: ['1.1'], sizeLimit: 0 },
    { onPage: (entries) => dns.push(...entries.map((entry) => entry.dn)), signal },
  )
  return { dns, incomplete: result.incomplete && !result.cancelled, cancelled: result.cancelled }
}

export async function countSubtree(
  session: LdapSession,
  dn: string,
  signal?: AbortSignal,
): Promise<SubtreeCount> {
  const { dns, incomplete } = await listSubtree(session, dn, signal)
  return { count: dns.length, incomplete }
}

export interface SubtreeDeleteOptions {
  onProgress: (progress: { deleted: number; total: number }) => void
  onDeleted?: (dns: string[]) => void
  signal?: AbortSignal | undefined
}

export interface SubtreeDeleteResult {
  deleted: number
  total: number
  cancelled: boolean
  /** Set when the delete stopped because the server refused an entry. */
  failedDn?: string
  error?: AppError
}

/** Deepest entries first, so every entry is a leaf by the time it is deleted. */
export function deletionOrder(dns: string[]): string[] {
  return dns
    .map((dn) => ({ dn, depth: parseDnStrict(dn).length }))
    .sort((a, b) => b.depth - a.depth)
    .map((item) => item.dn)
}

/**
 * Deletes `dn` and everything below it. Stops at the first entry the server refuses and
 * reports how many entries were deleted and which one failed; cancelling stops between entries.
 */
export async function deleteSubtree(
  session: LdapSession,
  dn: string,
  options: SubtreeDeleteOptions,
): Promise<SubtreeDeleteResult> {
  const { signal } = options
  const listing = await listSubtree(session, dn, signal)
  const total = listing.dns.length
  if (listing.cancelled || signal?.aborted) {
    return { deleted: 0, total, cancelled: true }
  }
  if (listing.incomplete) {
    // Deleting a partial listing children-first could leave entries the server never listed.
    return {
      deleted: 0,
      total,
      cancelled: false,
      failedDn: dn,
      error: {
        kind: 'invalidRequest',
        message: 'The server did not list the whole subtree, so nothing was deleted.',
      },
    }
  }
  options.onProgress({ deleted: 0, total })

  if (session.rootDse.supportedControls.includes(TREE_DELETE_OID)) {
    try {
      await session.deleteTree(dn)
    } catch (error) {
      return { deleted: 0, total, cancelled: false, failedDn: dn, error: toAppError(error) }
    }
    options.onDeleted?.(listing.dns)
    options.onProgress({ deleted: total, total })
    return { deleted: total, total, cancelled: false }
  }

  let deleted = 0
  for (const entryDn of deletionOrder(listing.dns)) {
    if (signal?.aborted) {
      return { deleted, total, cancelled: true }
    }
    try {
      await session.deleteEntry(entryDn)
    } catch (error) {
      return { deleted, total, cancelled: false, failedDn: entryDn, error: toAppError(error) }
    }
    deleted++
    options.onDeleted?.([entryDn])
    options.onProgress({ deleted, total })
  }
  return { deleted, total, cancelled: false }
}
