import { EmptyState } from '@renderer/components/EmptyState'
import { PaneHeader } from '@renderer/components/PaneHeader'
import { useConnections } from '@renderer/state/connections'
import { useTree } from '@renderer/state/tree'
import { DirectoryTree } from './DirectoryTree'

/** The tree of the selected connection (directory-tree spec: tree roots, browsing). */
export function DirectoryPane(): React.JSX.Element {
  const profile = useConnections((store) =>
    store.profiles.find((candidate) => candidate.id === store.activeProfileId),
  )
  const state = useConnections((store) =>
    store.activeProfileId ? store.states[store.activeProfileId] : undefined,
  )
  const connectionId =
    state?.status === 'connected'
      ? state.connectionId
      : state?.status === 'error'
        ? state.connectionId
        : undefined
  const tree = useTree((store) => (connectionId ? store.trees[connectionId] : undefined))
  const lost = state?.status === 'error' && state.lost === true

  return (
    <section className="flex h-full flex-col" aria-label="Directory">
      <PaneHeader title={profile && tree ? `Directory of ${profile.name}` : 'Directory'} />
      {lost && tree ? (
        <p
          role="status"
          className="mx-4 mb-2 rounded-sm border border-warning/40 px-3 py-2 text-xs text-warning"
        >
          The connection was lost. The entries shown may be out of date and cannot be changed until you
          reconnect.
        </p>
      ) : null}
      <div className="min-h-0 flex-1">
        {connectionId && tree ? (
          tree.rootKeys.length > 0 ? (
            <DirectoryTree connectionId={connectionId} tree={tree} readOnly={lost} />
          ) : (
            <EmptyState>
              The server advertises no naming contexts. Set a base DN in the connection settings to browse it.
            </EmptyState>
          )
        ) : (
          <EmptyState>
            {profile && state?.status === 'connecting'
              ? `Connecting to ${profile.name}…`
              : 'Connect to a server to browse its directory.'}
          </EmptyState>
        )}
      </div>
    </section>
  )
}
