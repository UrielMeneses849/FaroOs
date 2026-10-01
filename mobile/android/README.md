# FARO Mobile 0.1 — Android

Aplicación Android nativa con Kotlin + Jetpack Compose. No usa WebView ni un backend móvil paralelo: consume el mismo proyecto Supabase, sesión JWT, RLS, tablas, RPC y Edge Function `faro-voice` de FARO Web/Desktop.

## Primer arranque

Desde esta carpeta:

```sh
./gradlew assembleDebug
```

El build busca `SUPABASE_URL` y `SUPABASE_PUBLISHABLE_KEY` en este orden:

1. `mobile/android/local.properties`;
2. variables de entorno con esos nombres;
3. `../../.env.local` o `../../.env` como `VITE_SUPABASE_URL` y `VITE_SUPABASE_PUBLISHABLE_KEY`.

Por tanto, el `.env.local` que ya usa Web/Desktop basta en desarrollo. Nunca subas `local.properties` ni claves privadas. La publishable/anon key de Supabase es la única que debe estar en el APK; las service-role keys jamás van en Android.

## APK e instalación

El APK debug queda en:

`app/build/outputs/apk/debug/app-debug.apk`

Con un emulador o teléfono por USB autorizado:

```sh
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

Para un teléfono real: activa **Opciones de desarrollador → Depuración USB**, conecta el teléfono, acepta la huella RSA y confirma con `adb devices`. Como alternativa, copia ese APK al teléfono y permite la instalación desde la app de archivos elegida.

## Superficies implementadas

- Inicio: próximo compromiso, gasto actual, disponible calculado, tareas y eventos del día.
- Finanzas: saldos/movimientos, alta de gasto o ingreso, edición y borrado por el RPC seguro existente.
- Backlog: listas por estado; alta, edición, cambio de estado y borrado de tareas, con workspace, fecha, duración y prioridad.
- Agenda: FARO Calendar con alta, edición/movimiento y borrado; fuentes Google visibles solo lectura.
- FARO Voice: transcripción Android, llamada a `faro-voice` con `surface: mobile`, respuesta hablada y confirmación/cancelación con el mismo `requestId` de Web/Desktop.
- Sesión Supabase con refresh token en `EncryptedSharedPreferences` protegido por Android Keystore.
- Launcher App Shortcuts, widget de inicio y Quick Settings Tile enlazados por `faro://`.

## Verificación

```sh
./gradlew testDebugUnitTest
./gradlew lintDebug
./gradlew assembleDebug
```

Las pruebas cubren parsing de deep links/quick actions, payloads Finance/Task/Calendar, pendingAction y transiciones de estado del ViewModel.
