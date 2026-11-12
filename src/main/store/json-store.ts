/**
 * Small versioned JSON files in the app's data directory (design §7). Writes are atomic
 * (temp file, flush, rename) and serialized; unreadable files are kept aside, not discarded.
 */
import { randomUUID } from 'node:crypto'
import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import type { z } from 'zod'

/** Thrown for storage problems the user should hear about; maps to `{ kind: 'storage' }`. */
export class StorageError extends Error {}

export interface JsonStoreOptions<T> {
  /** Current file format version, written into every file. */
  version: number
  /** Validates the data part of the file (everything except `version`). */
  schema: z.ZodType<T>
  defaults: () => T
}

export class JsonStore<T> {
  private writes: Promise<unknown> = Promise.resolve()

  constructor(
    readonly path: string,
    private readonly options: JsonStoreOptions<T>,
  ) {}

  /**
   * Reads the file. A missing file gives the defaults; a corrupt or invalid one is renamed to
   * `<name>.corrupt-<time>` and the defaults are used. A file from a newer app version is refused.
   */
  async read(): Promise<T> {
    let text: string
    try {
      text = await readFile(this.path, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return this.options.defaults()
      }
      throw new StorageError(`Could not read ${basename(this.path)}: ${(error as Error).message}`)
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      await this.setAside()
      return this.options.defaults()
    }
    const version =
      typeof parsed === 'object' && parsed !== null ? (parsed as { version?: unknown }).version : undefined
    if (typeof version === 'number' && version > this.options.version) {
      throw new StorageError(
        `${basename(this.path)} was written by a newer version of LDAP Studio (format ${version}). Update the app to use it.`,
      )
    }
    const { version: _version, ...data } = parsed as Record<string, unknown>
    const result = this.options.schema.safeParse(data)
    if (version !== this.options.version || !result.success) {
      await this.setAside()
      return this.options.defaults()
    }
    return result.data
  }

  /** Writes atomically. Concurrent writes are applied in call order. */
  write(data: T): Promise<void> {
    const next = this.writes.then(() => this.writeNow(data))
    this.writes = next.catch(() => undefined)
    return next
  }

  private async writeNow(data: T): Promise<void> {
    const directory = dirname(this.path)
    await mkdir(directory, { recursive: true })
    const temp = join(directory, `.${basename(this.path)}.${randomUUID()}.tmp`)
    const content = `${JSON.stringify({ version: this.options.version, ...data }, null, 2)}\n`
    const handle = await open(temp, 'w', 0o600)
    try {
      await handle.writeFile(content, 'utf8')
      await handle.sync()
    } finally {
      await handle.close()
    }
    try {
      await rename(temp, this.path)
    } catch (error) {
      await unlink(temp).catch(() => undefined)
      throw new StorageError(`Could not save ${basename(this.path)}: ${(error as Error).message}`)
    }
  }

  private async setAside(): Promise<void> {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    await rename(this.path, `${this.path}.corrupt-${stamp}`).catch(() => undefined)
  }
}
