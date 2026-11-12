import { useEffect, useState } from 'react'

/** Whether passwords can be saved securely on this system, and why not. */
export function useSecretsAvailability(): { available: boolean; reason?: string | undefined } {
  const [state, setState] = useState<{ available: boolean; reason?: string | undefined }>({ available: true })
  useEffect(() => {
    void window.api.invoke('secrets.canSavePasswords', {}).then((result) => {
      if (result.ok) {
        setState(result.value)
      }
    })
  }, [])
  return state
}
