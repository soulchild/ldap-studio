import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import './styles.css'
import { followColorScheme } from './lib/theme'
import { useConnections } from './state/connections'
import { useLog } from './state/log'
import { useTree } from './state/tree'

followColorScheme()

if (window.__e2e) {
  window.__stores = { tree: useTree, connections: useConnections, log: useLog }
}

const container = document.getElementById('root')
if (!container) {
  throw new Error('Root element #root not found')
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
