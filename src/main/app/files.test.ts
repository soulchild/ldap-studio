import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { StorageError } from '../store/json-store'
import { MAX_VALUE_BYTES, readValueFile, writeValueFile } from './files'

let directory: string

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'ldap-studio-files-'))
})

afterEach(async () => {
  await rm(directory, { recursive: true, force: true })
})

describe('value files', () => {
  it('writes and reads bytes unchanged, including every byte value', async () => {
    const bytes = Uint8Array.from({ length: 256 }, (_, i) => i)
    const path = join(directory, 'value.bin')
    await writeValueFile(path, bytes)
    expect(new Uint8Array(await readFile(path))).toEqual(bytes)
    expect(await readValueFile(path)).toEqual(bytes)
  })

  it('refuses files larger than 20 MB', async () => {
    const path = join(directory, 'huge.bin')
    await writeFile(path, Buffer.alloc(MAX_VALUE_BYTES + 1))
    await expect(readValueFile(path)).rejects.toBeInstanceOf(StorageError)
  })
})
