# FARO Core multiplataforma

## Core compartido

- Tipos, schemas y reglas de Finance, Calendar y Backlog en `src/types`, `src/features/*/*Types`, repositorios y servicios.
- Autenticación, datos, RLS, RPC, Realtime y Edge Functions del mismo proyecto Supabase.
- FARO Voice: schemas, conversación, `voiceService`, Model Router, skills y observabilidad en Edge Functions.
- UI React compartida: rutas, páginas, componentes y providers.

## Adaptadores de plataforma

| Clasificación | Implementación actual | Desktop macOS |
| --- | --- | --- |
| Web adapter | Web Speech API, `speechSynthesis`, `Audio`/`MediaSource`, `getUserMedia` y `RTCPeerConnection` en `webVoiceAdapters.ts`. | Implementará los mismos contratos de `src/core/voice/adapters.ts`. |
| Web adapter | `localStorage`/`sessionStorage`, eventos DOM, `document`, responsive layout, permisos y navegación del navegador. | Tauri WebView los soporta; sesión y navegación pueden sustituirse por adapters nativos. |
| Desktop adapter | No existe todavía: no se agrega backend ni lógica de dominio. | Registrar `VoiceInputAdapter`, `AudioPlaybackAdapter`, `WakeListeningAdapter` y, opcionalmente, `FaroSessionStorage` antes de montar React. |
| Shared UI | React, Router, páginas y componentes. | Se reutilizan sin duplicar Finance, Calendar, Backlog o Voice. |

## Sesión y Supabase

`src/lib/supabase/client.ts` usa el mismo proyecto Supabase y acepta storage síncrono o asíncrono a través de `configureFaroRuntime({ sessionStorage })`. En Tauri, el valor por defecto es el almacenamiento persistente del WebView; una app macOS puede instalar un adapter de Stronghold/Store antes de cargar el cliente. Conserva la misma sesión/JWT, Edge Functions, RPC y RLS.

La entrada de Desktop será `startFaroDesktop()` en `src/desktop/startFaroDesktop.ts`: configura `surface: 'desktop'`, el storage y los adapters antes de importar la UI React existente.

## Surface de Voice

`voiceService` obtiene la surface de runtime. Lab sigue enviando `lab`; Web, `web`; Tauri se detecta como `desktop`; y clientes móviles pueden configurar `mobile`. La página (`dashboard`, `today`, `finances`, `lab`) permanece separada de la plataforma.
