/** Reading and writing binary attribute values as files (entry-editing spec: import and export). */
import { readFile, stat, writeFile } from 'node:fs/promises'
import { basename } from 'node:path'
import { StorageError } from '../store/json-store'

/** Larger files are almost certainly not meant for a directory attribute. */
export const MAX_VALUE_BYTES = 20 * 1024 * 1024

export async function readValueFile(path: string): Promise<Uint8Array<ArrayBuffer>> {
  const info = await stat(path)
  if (info.size > MAX_VALUE_BYTES) {
    throw new StorageError(
      `${basename(path)} is larger than 20 MB, which is too large for a directory attribute.`,
    )
  }
  return new Uint8Array(await readFile(path))
}

export async function writeValueFile(path: string, bytes: Uint8Array): Promise<void> {
  await writeFile(path, bytes)
}
