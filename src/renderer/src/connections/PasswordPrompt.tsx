import { useState } from 'react'
import { Button } from '@renderer/components/ui/button'
import { Checkbox } from '@renderer/components/ui/checkbox'
import { Dialog } from '@renderer/components/ui/dialog'
import { Field } from '@renderer/components/ui/field'
import { Input } from '@renderer/components/ui/input'
import { useConnections } from '@renderer/state/connections'
import type { Profile } from '@shared/ipc'
import { useSecretsAvailability } from './useSecretsAvailability'

/** Asks for the bind password of a profile that has none saved (connection-management spec). */
export function PasswordPrompt(): React.JSX.Element | null {
  const dialog = useConnections((state) => state.dialog)
  const profiles = useConnections((state) => state.profiles)
  if (dialog?.kind !== 'password') {
    return null
  }
  const profile = profiles.find((candidate) => candidate.id === dialog.profileId)
  if (!profile) {
    return null
  }
  // A new key per prompt (including a retry after a wrong password) starts with an empty field.
  return <PasswordForm key={`${profile.id}:${dialog.error ?? ''}`} profile={profile} error={dialog.error} />
}

function PasswordForm({
  profile,
  error,
}: {
  profile: Profile
  error: string | undefined
}): React.JSX.Element {
  const connect = useConnections((state) => state.connect)
  const closeDialog = useConnections((state) => state.closeDialog)
  const secrets = useSecretsAvailability()
  const [password, setPassword] = useState('')
  const [save, setSave] = useState(false)

  return (
    <Dialog
      open
      onOpenChange={(next) => !next && closeDialog()}
      title={`Connect to ${profile.name}`}
      description={
        <>
          Enter the password for <span className="font-mono break-all">{profile.bindDn}</span>.
        </>
      }
      footer={
        <>
          <Button onClick={closeDialog}>Cancel</Button>
          <Button variant="primary" type="submit" form="password-prompt" disabled={password === ''}>
            Connect
          </Button>
        </>
      }
    >
      <form
        id="password-prompt"
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault()
          if (password !== '') {
            void connect(profile.id, { password, savePassword: save && secrets.available })
          }
        }}
      >
        <Field label="Password" htmlFor="prompt-password" error={error}>
          <Input
            id="prompt-password"
            type="password"
            autoFocus
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            aria-invalid={error ? true : undefined}
          />
        </Field>
        <div className="flex flex-col gap-1">
          <Checkbox
            label="Save password"
            checked={save && secrets.available}
            disabled={!secrets.available}
            onChange={(event) => setSave(event.target.checked)}
          />
          {!secrets.available && secrets.reason ? (
            <p className="text-xs text-muted-foreground">{secrets.reason}</p>
          ) : null}
        </div>
      </form>
    </Dialog>
  )
}
