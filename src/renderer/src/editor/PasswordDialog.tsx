import { useEffect, useState } from 'react'
import { Button } from '@renderer/components/ui/button'
import { Dialog } from '@renderer/components/ui/dialog'
import { Field } from '@renderer/components/ui/field'
import { Input } from '@renderer/components/ui/input'
import {
  DEFAULT_PASSWORD_METHOD,
  hashPassword,
  newSalt,
  PASSWORD_METHODS,
  type PasswordMethod,
} from '@shared/password'

/**
 * Sets a password value (entry-editing spec: set password values): typed twice, hashed with the
 * chosen method, and handed back as the value to store. Writing it is left to the normal save.
 */
export function PasswordDialog({
  onSet,
  onCancel,
}: {
  onSet: (value: string) => void
  onCancel: () => void
}): React.JSX.Element {
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [method, setMethod] = useState<PasswordMethod>(DEFAULT_PASSWORD_METHOD)
  const [salt, setSalt] = useState(() => newSalt(method))
  // Hashing is asynchronous: keep the inputs with the result, so a hash of earlier input is
  // never shown or set.
  const [hashed, setHashed] = useState<{
    password: string
    method: PasswordMethod
    salt: Uint8Array | undefined
    value: string
  }>()

  useEffect(() => {
    let current = true
    if (password !== '') {
      void hashPassword(password, method, salt).then((value) => {
        if (current) {
          setHashed({ password, method, salt, value })
        }
      })
    }
    return () => {
      current = false
    }
  }, [password, method, salt])

  const stored =
    hashed &&
    password !== '' &&
    hashed.password === password &&
    hashed.method === method &&
    hashed.salt === salt
      ? hashed.value
      : ''
  const mismatch = confirmation !== '' && confirmation !== password
  const ready = password !== '' && confirmation === password && stored !== ''
  const set = () => {
    if (ready) {
      onSet(stored)
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) {
          onCancel()
        }
      }}
      title="Set password"
      footer={
        <>
          <Button onClick={onCancel}>Cancel</Button>
          <Button variant="primary" type="submit" form="set-password" disabled={!ready}>
            OK
          </Button>
        </>
      }
    >
      <form
        id="set-password"
        className="flex flex-col gap-3.5"
        onSubmit={(event) => {
          event.preventDefault()
          set()
        }}
      >
        <Field label="New password" htmlFor="password-new">
          <Input
            id="password-new"
            type="password"
            autoFocus
            autoComplete="new-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </Field>
        <Field
          label="Confirm password"
          htmlFor="password-confirm"
          error={mismatch ? 'The passwords do not match.' : undefined}
        >
          <Input
            id="password-confirm"
            type="password"
            autoComplete="new-password"
            value={confirmation}
            aria-invalid={mismatch}
            onChange={(event) => setConfirmation(event.target.value)}
          />
        </Field>
        <Field
          label="Hash method"
          htmlFor="password-method"
          hint="Choose a method the server supports, or binding with this password fails."
        >
          <select
            id="password-method"
            value={method}
            onChange={(event) => {
              const next = event.target.value as PasswordMethod
              setMethod(next)
              setSalt(newSalt(next))
            }}
            className="h-8 rounded-sm border border-input bg-surface pl-2 text-sm"
          >
            {PASSWORD_METHODS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Stored value" htmlFor="password-stored">
          <div className="flex items-center gap-2">
            <Input id="password-stored" readOnly value={stored} mono className="flex-1 text-xs" />
            <Button disabled={!salt} onClick={() => setSalt(newSalt(method))}>
              New salt
            </Button>
          </div>
        </Field>
      </form>
    </Dialog>
  )
}
