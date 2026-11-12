import { LockOpen, MoreHorizontal, Plus, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { ConfirmDialog } from '@renderer/components/ConfirmDialog'
import { EmptyState } from '@renderer/components/EmptyState'
import { IconButton } from '@renderer/components/IconButton'
import { PaneHeader } from '@renderer/components/PaneHeader'
import { Button } from '@renderer/components/ui/button'
import { DropdownMenu } from '@renderer/components/ui/dropdown-menu'
import { cn } from '@renderer/lib/utils'
import { describeConnectionError, useConnections, type ConnectionState } from '@renderer/state/connections'
import type { Profile } from '@shared/ipc'
import { CertificateDialog } from './CertificateDialog'
import { PasswordPrompt } from './PasswordPrompt'
import { useUi } from '@renderer/state/ui'
import { ProfileEditor } from './ProfileEditor'

const STATUS: Record<ConnectionState['status'], { label: string; dot: string }> = {
  disconnected: { label: 'Disconnected', dot: 'bg-subtle-foreground/50' },
  connecting: { label: 'Connecting', dot: 'bg-warning animate-pulse' },
  connected: { label: 'Connected', dot: 'bg-success' },
  error: { label: 'Error', dot: 'bg-destructive' },
}

type Editing = { profile: Profile | undefined } | undefined

/** Connection profiles with their state and actions (connection-management spec). */
export function ConnectionsPane(): React.JSX.Element {
  const profiles = useConnections((state) => state.profiles)
  const notice = useConnections((state) => state.notice)
  const dismissNotice = useConnections((state) => state.dismissNotice)
  const remove = useConnections((state) => state.remove)
  const [editing, setEditing] = useState<Editing>()
  const [deleting, setDeleting] = useState<Profile>()
  // "New connection…" from the command palette.
  useEffect(
    () =>
      useUi.subscribe((store, previous) => {
        if (store.newConnectionRequest !== previous.newConnectionRequest) {
          setEditing({ profile: undefined })
        }
      }),
    [],
  )

  return (
    <section className="flex h-full flex-col" aria-label="Connections">
      <PaneHeader
        title="Connections"
        actions={
          <IconButton label="New connection" onClick={() => setEditing({ profile: undefined })}>
            <Plus className="size-4" />
          </IconButton>
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        {profiles.length === 0 ? (
          <EmptyState
            action={
              <Button variant="primary" onClick={() => setEditing({ profile: undefined })}>
                New connection
              </Button>
            }
          >
            No connections yet.
          </EmptyState>
        ) : (
          <ul aria-label="Connection profiles" className="flex flex-col gap-px px-1.5 pb-1.5">
            {profiles.map((profile) => (
              <ProfileRow
                key={profile.id}
                profile={profile}
                onEdit={() => setEditing({ profile })}
                onDelete={() => setDeleting(profile)}
              />
            ))}
          </ul>
        )}
      </div>
      {notice ? (
        <div
          role="status"
          className="flex items-start gap-2 border-t px-4 py-2.5 text-xs text-muted-foreground"
        >
          <span className="min-w-0 flex-1">{notice}</span>
          <IconButton label="Dismiss" className="-my-1 size-6" onClick={dismissNotice}>
            <X className="size-3.5" />
          </IconButton>
        </div>
      ) : null}

      {editing ? <ProfileEditor profile={editing.profile} onClose={() => setEditing(undefined)} /> : null}
      <ConfirmDialog
        open={deleting !== undefined}
        title={`Delete “${deleting?.name ?? ''}”?`}
        description={
          deleting?.hasSavedPassword
            ? 'The connection and its saved password are deleted. This cannot be undone.'
            : 'The connection is deleted. This cannot be undone.'
        }
        confirmLabel="Delete"
        destructive
        onCancel={() => setDeleting(undefined)}
        onConfirm={() => {
          if (deleting) {
            void remove(deleting.id)
          }
          setDeleting(undefined)
        }}
      />
      <PasswordPrompt />
      <CertificateDialog />
    </section>
  )
}

function ProfileRow({
  profile,
  onEdit,
  onDelete,
}: {
  profile: Profile
  onEdit: () => void
  onDelete: () => void
}): React.JSX.Element {
  const state = useConnections((store) => store.states[profile.id]) ?? { status: 'disconnected' }
  const active = useConnections((store) => store.activeProfileId === profile.id)
  const { connect, disconnect, duplicate, setActive } = useConnections.getState()
  const status = STATUS[state.status]

  const primaryAction =
    state.status === 'connected' ? (
      <Button variant="ghost" className="h-7 px-2 text-xs" onClick={() => void disconnect(profile.id)}>
        Disconnect
      </Button>
    ) : state.status === 'connecting' ? null : (
      <Button variant="ghost" className="h-7 px-2 text-xs" onClick={() => void connect(profile.id)}>
        {state.status === 'error' ? 'Reconnect' : 'Connect'}
      </Button>
    )

  return (
    <li
      aria-label={profile.name}
      aria-current={active ? 'true' : undefined}
      data-status={state.status}
      className={cn(
        'group flex items-center gap-2.5 rounded-sm px-2 py-1',
        active ? 'bg-selection' : 'hover:bg-hover',
      )}
      onClick={() => setActive(profile.id)}
      onDoubleClick={() => {
        if (state.status !== 'connected' && state.status !== 'connecting') {
          void connect(profile.id)
        }
      }}
    >
      <span className={cn('size-2 shrink-0 rounded-full', status.dot)} role="img" aria-label={status.label} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{profile.name}</p>
        {state.status === 'error' ? (
          <p className="truncate text-xs text-destructive" title={describeConnectionError(state.error)}>
            {describeConnectionError(state.error)}
          </p>
        ) : (
          <p className="flex items-center gap-1 text-xs text-muted-foreground">
            {profile.security === 'none' ? (
              <LockOpen className="size-3 shrink-0 text-warning" role="img" aria-label="Not encrypted">
                <title>Not encrypted</title>
              </LockOpen>
            ) : null}
            <span className="truncate">
              {profile.host}:{profile.port}
            </span>
          </p>
        )}
      </div>
      <div
        className={cn(
          'flex shrink-0 items-center transition-opacity',
          // Actions appear on hover, keyboard focus, or for the selected row, leaving room for names.
          active ? 'opacity-100' : 'opacity-0 group-focus-within:opacity-100 group-hover:opacity-100',
        )}
        onDoubleClick={(event) => event.stopPropagation()}
      >
        {primaryAction}
        <DropdownMenu
          label={`Actions for ${profile.name}`}
          trigger={
            <IconButton label={`More actions for ${profile.name}`}>
              <MoreHorizontal className="size-4" />
            </IconButton>
          }
          items={[
            { label: 'Edit…', onSelect: onEdit },
            { label: 'Duplicate', onSelect: () => void duplicate(profile.id) },
            'separator',
            { label: 'Delete…', onSelect: onDelete, destructive: true },
          ]}
        />
      </div>
    </li>
  )
}
