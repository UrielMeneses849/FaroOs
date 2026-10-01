import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig(({ command, mode }) => {
  // GitHub Pages publishes this repository at /FaroOs/. Keep local
  // development at the root so existing localhost URLs continue to work.
  // Tauri embeds the same React bundle and needs relative asset paths. GitHub
  // Pages keeps its repository base; localhost remains rooted at '/'.
  const pagesBuild = mode !== 'tauri' && (command === 'build' || mode === 'production')
  const base = mode === 'tauri' ? './' : pagesBuild ? '/FaroOs/' : '/'
  const webScope = pagesBuild ? '/FaroOs/' : '/'

  return {
    base,
    plugins: [
      react(),
      tailwindcss(),
      VitePWA({
        // Keep the native Tauri bundle free from browser service-worker output,
        // while preserving the virtual module used by the shared React tree.
        disable: mode === 'tauri',
        registerType: 'prompt',
        injectRegister: null,
        manifest: {
          id: webScope,
          name: 'FARO OS',
          short_name: 'FARO',
          description: 'Tu sistema operativo personal para organizar, decidir y avanzar.',
          lang: 'es-MX',
          dir: 'ltr',
          start_url: webScope,
          scope: webScope,
          display: 'standalone',
          display_override: ['window-controls-overlay', 'standalone', 'minimal-ui'],
          orientation: 'any',
          background_color: '#05070c',
          theme_color: '#05070c',
          categories: ['productivity', 'finance', 'lifestyle'],
          icons: [
            { src: 'pwa-icons/faro-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
            { src: 'pwa-icons/faro-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
            { src: 'pwa-icons/faro-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          ],
          shortcuts: [
            { name: 'Hoy', short_name: 'Hoy', url: `${webScope}today` },
            { name: 'Finanzas', short_name: 'Finanzas', url: `${webScope}finance` },
            { name: 'Calendario', short_name: 'Calendario', url: `${webScope}calendar` },
          ],
          share_target: {
            action: `${webScope}share-target`,
            method: 'POST',
            enctype: 'multipart/form-data',
            params: {
              title: 'title',
              text: 'text',
              files: [{ name: 'receipt', accept: ['image/png', 'image/jpeg', 'image/webp', '.png', '.jpg', '.jpeg', '.webp'] }],
            },
          },
        },
        workbox: {
          cleanupOutdatedCaches: true,
          clientsClaim: true,
          importScripts: ['share-target-sw.js'],
          navigateFallback: 'index.html',
          globPatterns: ['**/*.{js,css,html,png,svg,ico,woff,woff2}'],
          // FARO contains private, live Supabase data. Cache only the compiled
          // application shell; authenticated API responses must stay online.
          navigateFallbackDenylist: [/^\/auth\//, /^\/rest\//, /^\/functions\//, /^\/storage\//],
        },
        devOptions: { enabled: false },
      }),
    ],
    test: {
      environment: 'jsdom',
      setupFiles: './src/test/setup.ts',
      css: true,
    },
  }
})
