import { isFaroTauriRuntime } from './core/platform/runtime'

async function start() {
  if (isFaroTauriRuntime()) {
    const { startFaroDesktop } = await import('./desktop/startFaroDesktop')
    await startFaroDesktop()
    return
  }
  await import('./bootstrap')
}

void start().catch((error) => {
  console.error('[FARO Desktop] frontend bootstrap failed', error)
  const detail = import.meta.env.DEV
    ? `\n\n${String(error instanceof Error ? error.stack ?? error.message : error)}`
    : ''
  // Never leave a production window black. This is deliberately a small,
  // dependency-free recovery surface in case a future native integration
  // fails before React mounts.
  document.body.innerHTML = `<main style="min-height:100vh;display:grid;place-items:center;margin:0;background:#05070c;color:#edf3ff;font:16px -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif"><section style="max-width:420px;padding:32px;text-align:center"><h1 style="margin:0 0 12px;font-size:24px">FARO no pudo iniciar</h1><p style="margin:0;color:#aab7ce;line-height:1.5">Reinicia FARO. Si el problema persiste, vuelve a abrir la aplicación desde Applications.</p><button onclick="location.reload()" style="margin-top:24px;padding:10px 16px;border:1px solid #2864d7;border-radius:10px;background:#0b1c40;color:#eef4ff;cursor:pointer">Reintentar</button><pre style="white-space:pre-wrap;text-align:left;color:#ffabb5;font:12px ui-monospace,monospace">${detail}</pre></section></main>`
})
