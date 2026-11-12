/** Safety net: close any app instance a failed or interrupted test left running. */
import { execFileSync } from 'node:child_process'
import { realpathSync } from 'node:fs'
import { resolve } from 'node:path'

export default function globalTeardown(): void {
  // The running process has the real path, not the node_modules/electron symlink.
  const electron = realpathSync(resolve(__dirname, '../../node_modules/electron/dist'))
  try {
    execFileSync('pkill', ['-f', electron])
  } catch {
    // pkill exits with 1 when nothing matched.
  }
}
