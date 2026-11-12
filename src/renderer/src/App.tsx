import { useEffect } from 'react'
import { useConnections } from '@renderer/state/connections'
import { useLog } from '@renderer/state/log'
import { useSettings } from '@renderer/state/settings'
import { Workspace } from '@renderer/shell/Workspace'

export function App(): React.JSX.Element | null {
  const settings = useSettings((state) => state.settings)
  const error = useSettings((state) => state.error)
  const load = useSettings((state) => state.load)

  const followLog = useLog((state) => state.follow)
  const loadProfiles = useConnections((state) => state.load)
  const watchConnections = useConnections((state) => state.watch)

  useEffect(() => {
    void load()
    void followLog()
    void loadProfiles()
    void watchConnections()
  }, [load, followLog, loadProfiles, watchConnections])

  if (error && !settings) {
    return <p className="p-6 text-sm text-destructive">LDAP Studio could not load its settings: {error}</p>
  }
  // Settings load from a local file in a few milliseconds; render nothing until they arrive
  // so panes appear at their saved sizes instead of jumping.
  return settings ? <Workspace settings={settings} /> : null
}
