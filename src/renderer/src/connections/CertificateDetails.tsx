import type { CertificateInfo } from '@shared/ipc'

const date = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' })

/** Subject, issuer, validity and fingerprint of a certificate, for a trust decision. */
export function CertificateDetails({ certificate }: { certificate: CertificateInfo }): React.JSX.Element {
  const rows: [string, React.ReactNode][] = [
    ['Subject', certificate.subject],
    ['Issuer', certificate.issuer],
    [
      'Valid',
      `${date.format(new Date(certificate.validFrom))} to ${date.format(new Date(certificate.validTo))}`,
    ],
    [
      'SHA-256 fingerprint',
      <span className="font-mono text-xs break-all">{certificate.fingerprint256}</span>,
    ],
  ]
  return (
    <dl className="selectable grid grid-cols-[9rem_1fr] gap-x-4 gap-y-2 text-sm">
      {rows.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-muted-foreground">{label}</dt>
          <dd className="min-w-0 break-words">{value}</dd>
        </div>
      ))}
    </dl>
  )
}
