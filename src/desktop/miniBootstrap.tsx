import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/poppins/400.css'
import '@fontsource/poppins/500.css'
import '@fontsource/poppins/600.css'
import './mini/mini.css'
import { MiniErrorBoundary } from './mini/MiniErrorBoundary'
import { FaroMini } from './FaroMini'

document.documentElement.dataset.faroWindow = 'mini'

createRoot(document.getElementById('root')!).render(<StrictMode><MiniErrorBoundary><FaroMini /></MiniErrorBoundary></StrictMode>)
