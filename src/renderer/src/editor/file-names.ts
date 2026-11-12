import { classifyBinary, sniffImageType } from '@shared/binary'
import type { Bytes } from '@shared/entry'

/** File name to suggest when saving a value. */
export function suggestedFileName(attribute: string, bytes: Bytes): string {
  const base = attribute.split(';')[0] ?? attribute
  const image = sniffImageType(bytes)
  if (image) {
    return `${base}.${image === 'jpeg' ? 'jpg' : image}`
  }
  return classifyBinary(attribute, bytes) === 'certificate' ? `${base}.cer` : `${base}.bin`
}
