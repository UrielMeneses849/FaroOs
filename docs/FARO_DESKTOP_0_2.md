# FARO Desktop 0.2 — Lifecycle y FARO Mini

## Lifecycle nativo

- `tauri-plugin-single-instance` entrega una segunda apertura al proceso existente; éste muestra y enfoca `main`.
- Rust es el único dueño de las ventanas `main` y `mini`, del tray y de `Command + Shift + Space`.
- Cerrar `main` o `mini` sólo las oculta. `Salir de FARO` desregistra el shortcut, destruye ambas ventanas y termina el proceso.
- Los helpers nativos crean la ventana que falte con una URL determinada por label: `index.html` para `main` y `index.html?window=mini` para `mini`.

## FARO Mini

Mini es una ventana transparente de 144 × 144 px en standby. Usa el Orb existente, puede arrastrarse y mantiene un menú contextual con abrir FARO, hablar, fijar y salir. Click abre Voice; doble click abre la ventana principal.

El proceso principal conserva el último `FaroVoiceSnapshot`, de modo que Mini puede recuperar el estado aunque se haya inicializado después. Una pendingAction ensancha Mini y muestra su resumen, Cancelar y Confirmar. Los dos botones emiten `faro:voice-action`; el `AiLabConsole` principal invoca su mismo `voiceService.cancel` o `voiceService.confirm` y conserva la idempotencia de servidor.

## Voice y WKWebView

Ocultar `main` no desmonta React ni cancela Voice: Mini observa la misma sesión que sigue viva en la ventana principal. STT con Web Speech API sigue dependiendo de la disponibilidad de WKWebView; wake listening continuo no está garantizado. El fallback es iniciar Voice manualmente y usar el adapter WebRTC/getUserMedia actual después de autorizar micrófono. TTS sigue usando el adapter actual de ElevenLabs y fallback del WebView.

## Diagnóstico en desarrollo

Rust registra `desktop:start`, `desktop:single-instance`, operaciones de ventanas, tray, shortcut y estado Voice cuando se compila en debug. Si falla el bootstrap de frontend, `main.tsx` muestra el error en desarrollo en vez de dejar una WebView negra.
