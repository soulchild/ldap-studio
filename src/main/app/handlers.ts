/**
 * Maps every IPC operation to the application services. Operations that need Electron UI
 * (file dialogs, clipboard) are registered by the window code in index.ts.
 */
import type { SearchEntry, TreeNode } from '@shared/ipc'
import { AppErrorException } from '../ldap/errors'
import { LdapSession } from '../ldap/session'
import { countSubtree, deleteSubtree } from '../ldap/subtree'
import { loadSchema } from '../schema/service'
import { describeCertificate } from './certificates'
import type { IpcRouter } from '../ipc/router'
import { sessionConfig, type AppServices } from './services'

const TREE_ATTRIBUTES = ['objectClass', 'hasSubordinates', 'numSubordinates']

function firstValue(entry: SearchEntry, name: string): string | undefined {
  const values = entry.attributes.find(
    (attribute) => attribute.name.toLowerCase() === name.toLowerCase(),
  )?.values
  const value = values?.[0]
  return typeof value === 'string' ? value : undefined
}

/** `hasSubordinates` (OpenLDAP, 389-DS) or `numSubordinates`; unknown otherwise (AD). */
export function toTreeNode(entry: SearchEntry): TreeNode {
  const objectClasses =
    entry.attributes
      .find((attribute) => attribute.name.toLowerCase() === 'objectclass')
      ?.values.filter((value): value is string => typeof value === 'string') ?? []
  const node: TreeNode = { dn: entry.dn, objectClasses }
  const hasSubordinates = firstValue(entry, 'hasSubordinates')
  const numSubordinates = firstValue(entry, 'numSubordinates')
  if (hasSubordinates !== undefined) {
    node.hasChildren = hasSubordinates.toUpperCase() === 'TRUE'
  } else if (numSubordinates !== undefined) {
    node.hasChildren = Number(numSubordinates) > 0
  }
  return node
}

export function registerHandlers(router: IpcRouter, services: AppServices): void {
  // Profiles and secrets
  router.invoke('profiles.list', () => services.profiles.list())
  router.invoke('profiles.save', (request) => services.profiles.save(request))
  router.invoke('profiles.delete', async ({ id }) => {
    await services.profiles.delete(id)
    await services.history.removeProfile(id)
    return null
  })
  router.invoke('profiles.duplicate', ({ id }) => services.profiles.duplicate(id))
  router.invoke('profiles.trustCertificate', ({ id, fingerprint256 }) =>
    services.profiles.trustCertificate(id, fingerprint256),
  )
  router.invoke('secrets.canSavePasswords', async () => services.secrets.availability())

  router.invoke('history.list', ({ profileId }) => services.history.list(profileId))

  // Settings (settings.update is registered in index.ts, because a theme change touches native UI)
  router.invoke('settings.get', () => services.settings.get())

  // Connections
  router.invoke('connection.test', async (input) => {
    const password = input.password.action === 'set' ? input.password.value : undefined
    const saved =
      password === undefined && input.id !== undefined && input.password.action === 'keep'
        ? await services.profiles.password(input.id)
        : undefined
    const result = await LdapSession.open({
      ...sessionConfig(input, password ?? saved),
      connectTimeoutMs: 8000,
    })
    if (!result.ok) {
      throw new AppErrorException(result.error)
    }
    await result.value.close()
    return { rootDse: result.value.rootDse }
  })
  router.invoke('connection.connect', (request) => services.connect(request))
  router.invoke('connection.disconnect', async ({ connectionId }) => {
    await services.disconnect(connectionId)
    return null
  })
  router.stream('connection.watch', async (_request, context) => {
    const unsubscribe = services.onConnectionEvent((event) => context.page(event))
    await new Promise<void>((resolve) =>
      context.signal.addEventListener('abort', () => resolve(), { once: true }),
    )
    unsubscribe()
    return {}
  })

  // Schema
  router.invoke('schema.get', async ({ connectionId }) => {
    const session = services.session(connectionId)
    return session.schema ?? (await loadSchema(session))
  })
  router.invoke('schema.reload', ({ connectionId }) => loadSchema(services.session(connectionId)))

  // Entries
  router.invoke('entry.read', ({ connectionId, dn, includeOperational }) =>
    services.session(connectionId).readEntry(dn, includeOperational),
  )
  router.invoke('entry.add', async ({ connectionId, dn, attributes }) => {
    await services.session(connectionId).addEntry(dn, attributes)
    return null
  })
  router.invoke('entry.modify', async ({ connectionId, dn, changes, assert }) => {
    await services.session(connectionId).modifyEntry(dn, changes, assert)
    return null
  })
  router.invoke('entry.rename', async ({ connectionId, ...request }) => ({
    dn: await services.session(connectionId).renameEntry(request),
  }))
  router.invoke('entry.delete', async ({ connectionId, dn }) => {
    await services.session(connectionId).deleteEntry(dn)
    return null
  })
  router.invoke('entry.countSubtree', ({ connectionId, dn }) =>
    countSubtree(services.session(connectionId), dn),
  )

  // Binary values
  router.invoke('binary.describeCertificate', async ({ bytes }) => describeCertificate(bytes))

  // Streams
  router.stream('tree.children', async ({ connectionId, dn }, context) => {
    let loaded = 0
    const result = await services.session(connectionId).search(
      { base: dn, scope: 'one', filter: '(objectClass=*)', attributes: TREE_ATTRIBUTES, sizeLimit: 0 },
      {
        signal: context.signal,
        onQueued: () => context.progress({ loaded: 0, queued: true }),
        onPage: (entries) => {
          loaded += entries.length
          context.page({ nodes: entries.map(toTreeNode) })
          context.progress({ loaded })
        },
      },
    )
    return { incomplete: result.incomplete }
  })

  router.stream('search.run', async ({ connectionId, ...request }, context) => {
    const session = services.session(connectionId)
    await services.history.add(services.profileOf(connectionId).id, request)
    let loaded = 0
    const result = await session.search(request, {
      signal: context.signal,
      onQueued: () => context.progress({ loaded: 0, queued: true }),
      onPage: (entries) => {
        loaded += entries.length
        context.page({ entries })
        context.progress({ loaded })
      },
    })
    return { incomplete: result.incomplete, sizeLimitReached: result.sizeLimitReached }
  })

  router.stream('entry.deleteSubtree', async ({ connectionId, dn }, context) => {
    const result = await deleteSubtree(services.session(connectionId), dn, {
      signal: context.signal,
      onProgress: (progress) => context.progress(progress),
      onDeleted: (deletedDns) => context.page({ deletedDns }),
    })
    return {
      deleted: result.deleted,
      total: result.total,
      cancelled: result.cancelled,
      ...(result.failedDn !== undefined ? { failedDn: result.failedDn } : {}),
      ...(result.error !== undefined ? { error: result.error } : {}),
    }
  })

  router.stream('log.follow', async (_request, context) => {
    context.page({ records: services.log.entries() })
    const unsubscribe = services.log.subscribe((record) => context.page({ records: [record] }))
    await new Promise<void>((resolve) =>
      context.signal.addEventListener('abort', () => resolve(), { once: true }),
    )
    unsubscribe()
    return {}
  })
}
