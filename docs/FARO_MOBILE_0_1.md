# FARO Mobile 0.1 — Android MVP

## Diagnóstico de integración

FARO ya tiene la frontera adecuada para Android: el cliente móvil usa la misma URL y publishable key de Supabase, la misma sesión del usuario, las políticas RLS, tablas (`finance_*`, `tasks`, `calendar_entries`, `workspaces`) y el RPC `delete_finance_transaction_safely`. Voice no se replica: Android llama a `faro-voice` con `surface: "mobile"`, por lo que el Model Router, las skills Finance/Calendar/Backlog, las confirmaciones, costos y observabilidad siguen siendo centrales.

No hay servidor, tablas ni reglas exclusivas de Mobile.

## Arquitectura

```text
Compose UI → FaroViewModel → FaroRepository → SupabaseApi
                                      ├── Auth REST + refresh JWT cifrado
                                      ├── PostgREST bajo RLS
                                      ├── RPC existente
                                      └── Edge Function faro-voice (surface=mobile)
```

La UI usa un único estado observable, acciones hacia arriba y repositorios separados del Composable. Es coherente con las recomendaciones de arquitectura Android para data layer, StateFlow y flujo unidireccional. [Android Developers](https://developer.android.com/topic/architecture/recommendations?hl=en)

## Entregable 0.1

- Proyecto en `mobile/android/`, Kotlin, Compose Material 3 y minSdk 26.
- Navegación mobile-first: Inicio, Finanzas, FARO central, Agenda, Backlog.
- Acciones rápidas: gasto, tarea, evento y voz, centralizadas con `faro://quick/*` y `faro://voice`.
- Finanzas permite gasto e ingreso, y editar o eliminar movimientos con las mismas reglas financieras existentes.
- Backlog permite crear, editar, completar, eliminar y ajustar workspace, fecha, duración y prioridad.
- Agenda permite crear, editar/mover y eliminar solo eventos FARO; Google continúa en modo lectura.
- App shortcuts del launcher; widget compacto de 4 acciones; tile FARO abre Voice.
- Haptics ligeros al empezar voz y recibir respuesta. La respuesta usa TTS del sistema; la transcripción usa el reconocimiento de voz nativo y manda el texto al backend FARO existente.
- Manejo de carga, reintento en Voice (3 intentos), timeout y error visible; no se declara offline-first.
- Debug APK: `mobile/android/app/build/outputs/apk/debug/app-debug.apk`.

## QA realizado localmente

- `./gradlew testDebugUnitTest` — correcto.
- `./gradlew lintDebug` — correcto.
- `./gradlew assembleDebug` — APK debug generado.
- Se instaló un SDK 35 y JDK 17 locales ignorados por Git para la validación de este entorno.

Validación manual pendiente en emulador/teléfono: login con datos reales, permisos de micrófono, reconocimiento instalado en el dispositivo, widget/tile desde launcher/quick settings y operaciones reales sujetas a tus RLS.

## Instalación

Desde `mobile/android`:

```sh
./gradlew assembleDebug
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

Android Gradle Plugin 8.7 usa Gradle 8.9 y JDK 17; por eso el wrapper queda fijado en esa combinación. [AGP compatibility](https://developer.android.com/build/releases/about-agp?hl=en)

## Limitaciones deliberadas

- No hay Camera/OCR, Share → FARO, geofencing, reminders por ubicación, Device Control, BLE/UWB, FARO Micro/Room/Wear OS ni handoff avanzado.
- Agenda Google es explícitamente de solo lectura; solo FARO Calendar se escribe.
- Voice 0.1 usa SpeechRecognizer/TTS de Android como adaptador local de audio; las decisiones, la respuesta y las mutaciones siguen ocurriendo en `faro-voice`.
- No incluye sincronización offline ni cola local de mutaciones.
- La primera distribución es debug; para publicación hará falta un keystore de release y Play/App Signing.

## Mobile 0.2

1. Instrumented UI tests y QA en emulador/teléfono físico.
2. Selector de fecha/hora nativo y pruebas instrumentadas de los editores existentes.
3. Recuperación de redes, cache de lectura y cola explícita de reintentos.
4. Realtime/stream de la respuesta Voice y mejor contexto de agenda local.
5. Handoff Mac ↔ Mobile, Capture/Share/OCR, notificaciones y recordatorios como iniciativas posteriores, sin adelantar su implementación.
