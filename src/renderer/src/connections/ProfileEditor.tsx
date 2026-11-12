import { CircleAlert, CircleCheck, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { IconButton } from '@renderer/components/IconButton'
import { Button } from '@renderer/components/ui/button'
import { Dialog } from '@renderer/components/ui/dialog'
import { Field } from '@renderer/components/ui/field'
import { Input } from '@renderer/components/ui/input'
import { Segmented } from '@renderer/components/ui/segmented'
import { describeConnectionError, useConnections } from '@renderer/state/connections'
import { isValidBindName, isValidDn } from '@shared/dn'
import {
  DEFAULT_PORTS,
  type AppError,
  type CertificateInfo,
  type Profile,
  type ProfileInput,
  type SecurityMode,
} from '@shared/ipc'
import { CertificateDetails } from './CertificateDetails'
import { useSecretsAvailability } from './useSecretsAvailability'

const SECURITY_OPTIONS: { value: SecurityMode; label: string }[] = [
  { value: 'ldaps', label: 'LDAPS' },
  { value: 'starttls', label: 'StartTLS' },
  { value: 'none', label: 'None' },
]

type PasswordChoice = 'keep' | 'change' | 'remove'

interface CaCertificate {
  pem: string
  info?: CertificateInfo | undefined
}

type TestState =
  | { status: 'idle' }
  | { status: 'testing' }
  | { status: 'success'; namingContexts: string[] }
  | { status: 'failure'; error: AppError }

function pemToBytes(pem: string): Uint8Array<ArrayBuffer> {
  const base64 = pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '')
  return Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))
}

/** Create or edit a connection profile (connection-management spec: manage profiles, test connection). */
export function ProfileEditor({
  profile,
  onClose,
}: {
  /** The profile to edit, or undefined for a new one. */
  profile: Profile | undefined
  onClose: () => void
}): React.JSX.Element {
  const save = useConnections((state) => state.save)
  const secrets = useSecretsAvailability()

  const [name, setName] = useState(profile?.name ?? '')
  const [host, setHost] = useState(profile?.host ?? '')
  const [security, setSecurity] = useState<SecurityMode>(profile?.security ?? 'ldaps')
  const [port, setPort] = useState(String(profile?.port ?? DEFAULT_PORTS.ldaps))
  const [portEdited, setPortEdited] = useState(profile !== undefined)
  const [bindDn, setBindDn] = useState(profile?.bindDn ?? '')
  const [baseDn, setBaseDn] = useState(profile?.baseDn ?? '')
  const [password, setPassword] = useState('')
  const [passwordChoice, setPasswordChoice] = useState<PasswordChoice>('keep')
  const [certificates, setCertificates] = useState<CaCertificate[]>(
    (profile?.caCertificates ?? []).map((pem) => ({ pem })),
  )
  const [trustedFingerprint, setTrustedFingerprint] = useState(profile?.trustedFingerprint)
  const [test, setTest] = useState<TestState>({ status: 'idle' })
  const [showErrors, setShowErrors] = useState(false)
  const [saveError, setSaveError] = useState<string>()

  // Describe the stored CA certificates so the list can show their subjects.
  useEffect(() => {
    for (const pem of profile?.caCertificates ?? []) {
      void window.api.invoke('binary.describeCertificate', { bytes: pemToBytes(pem) }).then((result) => {
        if (result.ok) {
          setCertificates((current) =>
            current.map((item) => (item.pem === pem ? { ...item, info: result.value } : item)),
          )
        }
      })
    }
  }, [profile])

  const hasSavedPassword = profile?.hasSavedPassword === true && passwordChoice !== 'remove'
  const portNumber = Number(port)
  const errors = {
    name: name.trim() === '' ? 'Enter a name for this connection.' : undefined,
    host: host.trim() === '' ? 'Enter the server host name or address.' : undefined,
    port:
      !Number.isInteger(portNumber) || portNumber < 1 || portNumber > 65535
        ? 'Enter a port between 1 and 65535.'
        : undefined,
    bindDn:
      bindDn.trim() !== '' && !isValidBindName(bindDn)
        ? 'Enter a DN, or for Active Directory user@domain or DOMAIN\\user.'
        : undefined,
    baseDn: baseDn.trim() !== '' && !isValidDn(baseDn) ? 'This is not a valid DN.' : undefined,
  }
  const valid = Object.values(errors).every((error) => error === undefined)

  const changeSecurity = (next: SecurityMode) => {
    setSecurity(next)
    if (!portEdited) {
      setPort(String(DEFAULT_PORTS[next]))
    }
  }

  const passwordAction = (): ProfileInput['password'] => {
    if (profile?.hasSavedPassword && passwordChoice === 'keep') {
      return { action: 'keep' }
    }
    if (password !== '' && secrets.available) {
      return { action: 'set', value: password }
    }
    return profile?.hasSavedPassword ? { action: 'clear' } : { action: 'keep' }
  }

  const input = (): ProfileInput => ({
    ...(profile ? { id: profile.id } : {}),
    name: name.trim(),
    host: host.trim(),
    port: portNumber,
    security,
    bindDn: bindDn.trim(),
    baseDn: baseDn.trim(),
    caCertificates: certificates.map((certificate) => certificate.pem),
    ...(trustedFingerprint ? { trustedFingerprint } : {}),
    password: passwordAction(),
  })

  const runTest = async () => {
    setShowErrors(true)
    if (!valid) {
      return
    }
    setTest({ status: 'testing' })
    // Test with the password typed here, even if it is not going to be saved.
    const request =
      password !== '' ? { ...input(), password: { action: 'set' as const, value: password } } : input()
    const result = await window.api.invoke('connection.test', request)
    setTest(
      result.ok
        ? { status: 'success', namingContexts: result.value.rootDse.namingContexts }
        : { status: 'failure', error: result.error },
    )
  }

  const submit = async () => {
    setShowErrors(true)
    if (!valid) {
      return
    }
    const result = await save(input())
    if (result.ok) {
      onClose()
    } else {
      setSaveError(result.error.message)
    }
  }

  const addCertificate = async () => {
    const result = await window.api.invoke('profiles.importCaCertificate', {})
    if (!result.ok) {
      setSaveError(result.error.message)
      return
    }
    const imported = result.value
    if (imported && !certificates.some((certificate) => certificate.pem === imported.pem)) {
      setCertificates([...certificates, imported])
    }
  }

  const error = (key: keyof typeof errors) => (showErrors ? errors[key] : undefined)

  return (
    <Dialog
      open
      onOpenChange={(next) => !next && onClose()}
      title={profile ? 'Edit connection' : 'New connection'}
      className="w-[min(40rem,calc(100vw-2rem))]"
      footer={
        <>
          <Button className="mr-auto" onClick={() => void runTest()} disabled={test.status === 'testing'}>
            {test.status === 'testing' ? 'Testing…' : 'Test connection'}
          </Button>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="profile-editor">
            {profile ? 'Save changes' : 'Create connection'}
          </Button>
        </>
      }
    >
      <form
        id="profile-editor"
        className="flex flex-col gap-5"
        onSubmit={(event) => {
          event.preventDefault()
          void submit()
        }}
      >
        <Field label="Name" htmlFor="profile-name" error={error('name')}>
          <Input id="profile-name" autoFocus value={name} onChange={(event) => setName(event.target.value)} />
        </Field>

        <div className="grid grid-cols-[1fr_7rem] gap-3">
          <Field label="Host" htmlFor="profile-host" error={error('host')}>
            <Input
              id="profile-host"
              placeholder="ldap.example.com"
              value={host}
              onChange={(event) => setHost(event.target.value)}
            />
          </Field>
          <Field label="Port" htmlFor="profile-port" error={error('port')}>
            <Input
              id="profile-port"
              inputMode="numeric"
              value={port}
              onChange={(event) => {
                setPort(event.target.value)
                setPortEdited(true)
              }}
            />
          </Field>
        </div>

        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-muted-foreground">Encryption</span>
          <Segmented
            label="Encryption"
            value={security}
            options={SECURITY_OPTIONS}
            onChange={changeSecurity}
          />
          {security === 'none' && bindDn.trim() !== '' ? (
            <p className="flex items-center gap-1.5 text-xs text-warning">
              <CircleAlert className="size-3.5 shrink-0" aria-hidden />
              Without encryption, the bind DN and password are sent in plain text.
            </p>
          ) : null}
        </div>

        <Field
          label="Bind DN"
          htmlFor="profile-bind-dn"
          hint="A DN, or for Active Directory user@domain. Leave empty to connect anonymously."
          error={error('bindDn')}
        >
          <Input
            id="profile-bind-dn"
            mono
            placeholder="cn=admin,dc=example,dc=com"
            value={bindDn}
            onChange={(event) => setBindDn(event.target.value)}
          />
        </Field>

        {bindDn.trim() !== '' ? (
          hasSavedPassword && passwordChoice === 'keep' ? (
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-muted-foreground">Password</span>
              <div className="flex items-center gap-2 text-sm">
                <span>A password is saved for this connection.</span>
                <Button variant="ghost" className="h-7 px-2" onClick={() => setPasswordChoice('change')}>
                  Change
                </Button>
                <Button
                  variant="ghost"
                  className="h-7 px-2 text-destructive"
                  onClick={() => setPasswordChoice('remove')}
                >
                  Remove
                </Button>
              </div>
            </div>
          ) : (
            <Field
              label="Password"
              htmlFor="profile-password"
              hint={
                secrets.available
                  ? passwordChoice === 'remove'
                    ? 'The saved password will be removed. You will be asked for it when you connect.'
                    : 'Saved encrypted in the system keychain. Leave empty to be asked when you connect.'
                  : secrets.reason
              }
            >
              <Input
                id="profile-password"
                type="password"
                value={password}
                disabled={!secrets.available}
                onChange={(event) => setPassword(event.target.value)}
              />
            </Field>
          )
        ) : null}

        <Field
          label="Base DN"
          htmlFor="profile-base-dn"
          hint="Leave empty to use the naming contexts the server advertises."
          error={error('baseDn')}
        >
          <Input
            id="profile-base-dn"
            mono
            placeholder="dc=example,dc=com"
            value={baseDn}
            onChange={(event) => setBaseDn(event.target.value)}
          />
        </Field>

        {security !== 'none' ? (
          <div className="flex flex-col gap-2">
            <span className="text-xs font-medium text-muted-foreground">Trusted CA certificates</span>
            {certificates.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                The system's trusted certificate authorities are used. Add your own CA if the server's
                certificate comes from a private one.
              </p>
            ) : (
              <ul className="flex flex-col divide-y rounded-sm border" aria-label="Trusted CA certificates">
                {certificates.map((certificate) => (
                  <li
                    key={certificate.pem}
                    className="flex items-center justify-between gap-2 py-1.5 pr-1.5 pl-3"
                  >
                    <span className="min-w-0 truncate text-sm">
                      {certificate.info?.subject ?? 'Certificate'}
                    </span>
                    <IconButton
                      label={`Remove ${certificate.info?.subject ?? 'certificate'}`}
                      onClick={() => setCertificates(certificates.filter((item) => item !== certificate))}
                    >
                      <X className="size-4" />
                    </IconButton>
                  </li>
                ))}
              </ul>
            )}
            <div>
              <Button className="h-7" onClick={() => void addCertificate()}>
                Add certificate…
              </Button>
            </div>
            {trustedFingerprint ? (
              <div className="flex items-center justify-between gap-2 rounded-sm border py-1.5 pr-1.5 pl-3">
                <span className="min-w-0 text-sm">
                  Trusted server certificate{' '}
                  <span className="font-mono text-xs break-all text-muted-foreground">
                    {trustedFingerprint}
                  </span>
                </span>
                <IconButton
                  label="Stop trusting this certificate"
                  onClick={() => setTrustedFingerprint(undefined)}
                >
                  <X className="size-4" />
                </IconButton>
              </div>
            ) : null}
          </div>
        ) : null}

        <TestResult
          state={test}
          onTrust={(fingerprint) => {
            setTrustedFingerprint(fingerprint)
            setTest({ status: 'idle' })
          }}
        />
        {saveError ? <p className="text-sm text-destructive">{saveError}</p> : null}
      </form>
    </Dialog>
  )
}

function TestResult({
  state,
  onTrust,
}: {
  state: TestState
  onTrust: (fingerprint: string) => void
}): React.JSX.Element | null {
  if (state.status === 'success') {
    return (
      <div role="status" className="flex items-start gap-2 rounded-sm border px-3 py-2.5 text-sm">
        <CircleCheck className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
        <div className="min-w-0">
          <p>Connected successfully.</p>
          {state.namingContexts.length > 0 ? (
            <p className="text-xs break-all text-muted-foreground">
              Naming contexts: {state.namingContexts.join(', ')}
            </p>
          ) : null}
        </div>
      </div>
    )
  }
  if (state.status !== 'failure') {
    return null
  }
  const { error } = state
  return (
    <div
      role="alert"
      className="flex flex-col gap-3 rounded-sm border border-destructive/40 px-3 py-2.5 text-sm"
    >
      <p className="flex items-start gap-2">
        <CircleAlert className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
        <span>{describeConnectionError(error)}</span>
      </p>
      {error.kind === 'certificateUntrusted' ? (
        <>
          <CertificateDetails certificate={error.certificate} />
          <div>
            <Button className="h-7" onClick={() => onTrust(error.certificate.fingerprint256)}>
              Trust this certificate
            </Button>
          </div>
        </>
      ) : null}
    </div>
  )
}
