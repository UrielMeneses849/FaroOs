# FARO Desktop 0.1 (macOS Alpha)

## Ejecución

```bash
npm run tauri:dev
npm run tauri:build
```

El build local produce `src-tauri/target/release/bundle/macos/FARO.app` en Apple Silicon.

## Arquitectura

La app Tauri carga la misma UI React de `src/`. Finance, Calendar, Backlog, autenticación, Supabase, RLS, RPC, Edge Functions, FARO Voice, Model Router y observabilidad siguen siendo compartidos. Antes de montar React, `startFaroDesktop()` configura el runtime con `surface: "desktop"`; por ello las trazas de Voice usan la superficie Desktop.

La sesión de Supabase se conserva con el almacenamiento persistente del WebView. Es el mismo JWT y el mismo proyecto de Supabase que usa la web; no existe un backend, usuario o política de RLS específico para Desktop.

## Ventanas y menú

- La ventana principal reutiliza el Router y las pantallas web existentes.
- Al cerrarla se oculta; FARO continúa disponible desde el icono de la barra de menú.
- El menú ofrece abrir FARO, mostrar u ocultar FARO Mini y salir explícitamente.
- FARO Mini es una ventana sin chrome, arrastrable y con estado de Voice. Su botón abre la ventana principal y puede mantenerse siempre visible.
- `Command + Shift + Space` muestra u oculta FARO Mini mientras la app está en ejecución.

## Permisos y Voice

La única declaración nativa de permisos de esta Alpha es `NSMicrophoneUsageDescription`. No se solicita cámara, accesibilidad, contactos, calendario nativo ni permisos de inicio de sesión.

FARO Voice reutiliza los adapters existentes del WebView para entrada de voz, reproducción y escucha. Finance Voice, Calendar Voice y Backlog Voice siguen llamando a las mismas Edge Functions y registran `surface: "desktop"`.

`getUserMedia`/WebRTC puede usarse después de conceder micrófono. La disponibilidad de Web Speech API en WKWebView no es uniforme, por lo que el fallback actual es abrir Voice y activar manualmente el micrófono; el wake listening continuo no se considera garantizado hasta incorporar un adapter nativo de macOS. La reproducción de ElevenLabs sigue el adaptador de audio existente y debe validarse con credenciales de usuario y salida de audio real.

## Fuera de alcance de 0.1

No incluye firma, notarización, App Store, actualización automática, launch at login, daemon de wake word ni un almacenamiento Stronghold. Para distribución firmada se necesita instalar Xcode completo y una identidad de firma de Apple.
