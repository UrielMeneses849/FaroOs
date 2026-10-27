import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/poppins/400.css'
import '@fontsource/poppins/500.css'
import '@fontsource/poppins/600.css'
import './index.css'
import './monochrome.css'
import './styles/mobile-shell.css'
import './styles/mobile-core.css'
import './styles/mobile-sections.css'
import './styles/mobile-goals.css'
import App from './App'
import { DesktopErrorBoundary } from './desktop/DesktopErrorBoundary'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <DesktopErrorBoundary><App /></DesktopErrorBoundary>
  </StrictMode>,
)
