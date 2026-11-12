import { mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { JsonStore, StorageError } from './json-store'

const schema = z.object({ items: z.array(z.string()) })
type Data = z.infer<typeof schema>

let directory: string
let path: string
const store = (version = 1) => new JsonStore<Data>(path, { version, schema, defaults: () => ({ items: [] }) })

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'ldap-studio-store-'))
  path = join(directory, 'data.json')
})

afterEach(async () => {
  await rm(directory, { recursive: true, force: true })
})

describe('JsonStore', () => {
  it('returns the defaults when the file does not exist', async () => {
    expect(await store().read()).toEqual({ items: [] })
  })

  it('writes the version field and reads its own data back', async () => {
    await store().write({ items: ['a', 'b'] })
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({ version: 1, items: ['a', 'b'] })
    expect(await store().read()).toEqual({ items: ['a', 'b'] })
  })

  it('creates the file readable by the owner only', async () => {
    await store().write({ items: [] })
    expect((await stat(path)).mode & 0o777).toBe(0o600)
  })

  it('writes atomically, leaving no temp files and never a partial file', async () => {
    const target = store()
    await Promise.all(Array.from({ length: 20 }, (_, i) => target.write({ items: [`item ${i}`] })))
    expect(await readdir(directory)).toEqual(['data.json'])
    expect(await target.read()).toEqual({ items: ['item 19'] })
  })

  it('sets a corrupt file aside and starts from the defaults', async () => {
    await writeFile(path, '{ "version": 1, "items": [', 'utf8')
    expect(await store().read()).toEqual({ items: [] })
    const files = await readdir(directory)
    expect(files.some((file) => file.startsWith('data.json.corrupt-'))).toBe(true)
    expect(files).not.toContain('data.json')
  })

  it('sets aside a file that does not match the schema', async () => {
    await writeFile(path, JSON.stringify({ version: 1, items: 'not a list' }), 'utf8')
    expect(await store().read()).toEqual({ items: [] })
    expect((await readdir(directory)).some((file) => file.startsWith('data.json.corrupt-'))).toBe(true)
  })

  it('refuses a file from a newer app version and leaves it untouched', async () => {
    const content = JSON.stringify({ version: 2, items: ['future'] })
    await writeFile(path, content, 'utf8')
    await expect(store(1).read()).rejects.toBeInstanceOf(StorageError)
    expect(await readFile(path, 'utf8')).toBe(content)
  })
})
