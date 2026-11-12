import { Button } from '@renderer/components/ui/button'
import { Dialog } from '@renderer/components/ui/dialog'
import { useConnections } from '@renderer/state/connections'
import { CertificateDetails } from './CertificateDetails'

/** Shown when a server's certificate cannot be verified (connection-management spec: trust a certificate). */
export function CertificateDialog(): React.JSX.Element | null {
  const dialog = useConnections((state) => state.dialog)
  const profiles = useConnections((state) => state.profiles)
  const trustAndConnect = useConnections((state) => state.trustAndConnect)
  const closeDialog = useConnections((state) => state.closeDialog)

  if (dialog?.kind !== 'certificate') {
    return null
  }
  const profile = profiles.find((candidate) => candidate.id === dialog.profileId)
  const { error } = dialog

  return (
    <Dialog
      open
      onOpenChange={(next) => !next && closeDialog()}
      title={
        error.fingerprintMismatch
          ? 'The server certificate has changed'
          : 'The server certificate is not trusted'
      }
      description={
        <>
          {error.reason}{' '}
          {error.fingerprintMismatch
            ? 'It is not the certificate you trusted for this connection. Only trust it if you know why it changed.'
            : `Check the fingerprint with the administrator of ${profile?.host ?? 'the server'} before you trust it.`}
        </>
      }
      footer={
        <>
          <Button onClick={closeDialog}>Cancel</Button>
          <Button variant="primary" onClick={() => void trustAndConnect()}>
            Trust and connect
          </Button>
        </>
      }
    >
      <CertificateDetails certificate={error.certificate} />
    </Dialog>
  )
}
