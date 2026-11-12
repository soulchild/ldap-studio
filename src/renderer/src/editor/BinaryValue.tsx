import { useEffect, useMemo, useState } from 'react'
import {
  classifyBinary,
  formatByteSize,
  formatGuid,
  formatSid,
  hexPreview,
  IMAGE_MIME_TYPES,
  sniffImageType,
} from '@shared/binary'
import type { Bytes } from '@shared/entry'
import type { CertificateInfo } from '@shared/ipc'

const date = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' })

function toBase64(bytes: Bytes): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return btoa(binary)
}

/** A binary value shown by type (entry-editing spec: binary value display). Never decoded as text. */
export function BinaryValue({ attribute, bytes }: { attribute: string; bytes: Bytes }): React.JSX.Element {
  const kind = classifyBinary(attribute, bytes)
  const size = formatByteSize(bytes.length)
  switch (kind) {
    case 'image':
      return <ImageValue bytes={bytes} size={size} />
    case 'certificate':
      return <CertificateValue bytes={bytes} size={size} />
    case 'guid':
      return (
        <Text mono label="GUID">
          {formatGuid(bytes)}
        </Text>
      )
    case 'sid':
      return (
        <Text mono label="Security identifier">
          {formatSid(bytes)}
        </Text>
      )
    default:
      return (
        <span className="flex min-w-0 flex-1 flex-col px-2.5 py-1">
          <span className="text-xs text-muted-foreground">Binary, {size}</span>
          <span className="truncate font-mono text-xs" title={hexPreview(bytes, 256)}>
            {hexPreview(bytes, 24)}
          </span>
        </span>
      )
  }
}

function Text({
  children,
  mono,
  label,
}: {
  children: React.ReactNode
  mono?: boolean
  label: string
}): React.JSX.Element {
  return (
    <span className="selectable flex min-h-8 min-w-0 flex-1 items-center gap-2 px-2.5" aria-label={label}>
      <span className={mono ? 'font-mono text-sm break-all' : 'text-sm'}>{children}</span>
    </span>
  )
}

function ImageValue({ bytes, size }: { bytes: Bytes; size: string }): React.JSX.Element {
  const type = sniffImageType(bytes) ?? 'jpeg'
  // A data URL needs no cleanup, unlike a blob URL (the CSP allows data: images).
  const url = useMemo(() => `data:${IMAGE_MIME_TYPES[type]};base64,${toBase64(bytes)}`, [bytes, type])
  return (
    <span className="flex min-w-0 flex-1 items-center gap-3 px-2.5 py-1">
      {url ? (
        <img
          src={url}
          alt="Image value"
          className="size-16 shrink-0 rounded-sm border bg-background object-contain"
        />
      ) : (
        <span className="size-16 shrink-0" />
      )}
      <span className="text-xs text-muted-foreground">
        {type.toUpperCase()} image, {size}
      </span>
    </span>
  )
}

function CertificateValue({ bytes, size }: { bytes: Bytes; size: string }): React.JSX.Element {
  const [info, setInfo] = useState<(CertificateInfo & { expired: boolean }) | { error: string }>()
  useEffect(() => {
    let current = true
    void window.api.invoke('binary.describeCertificate', { bytes }).then((result) => {
      if (current) {
        setInfo(
          result.ok
            ? { ...result.value, expired: new Date(result.value.validTo).getTime() < Date.now() }
            : { error: result.error.message },
        )
      }
    })
    return () => {
      current = false
    }
  }, [bytes])
  if (!info) {
    return <Text label="Certificate">Certificate, {size}</Text>
  }
  if ('error' in info) {
    return (
      <span className="flex min-w-0 flex-1 flex-col px-2.5 py-1 text-xs text-muted-foreground">
        <span>Certificate, {size}. It could not be decoded.</span>
        <span className="font-mono">{hexPreview(bytes, 24)}</span>
      </span>
    )
  }
  const { expired } = info
  return (
    <span className="selectable flex min-w-0 flex-1 flex-col gap-0.5 px-2.5 py-1" aria-label="Certificate">
      <span className="text-sm break-words">{info.subject}</span>
      <span className="text-xs text-muted-foreground">Issued by {info.issuer}</span>
      <span className={expired ? 'text-xs text-destructive' : 'text-xs text-muted-foreground'}>
        {expired ? 'Expired' : 'Valid until'} {date.format(new Date(info.validTo))}
      </span>
    </span>
  )
}
