# FARO Voice — Capability 2: Calendar

Fecha de cierre técnico: 8 de agosto de 2026 (America/Mexico_City)

## 1. Arquitectura implementada

- Se conservó el pipeline optimizado de Capability 1 y se añadió un `calendarFastPath` determinista antes del pipeline financiero/LLM.
- `calendarSkill` normaliza `calendar_entries`, tareas programadas, Google Calendar seleccionado y fixtures Google aislados.
- Toda interpretación relativa recibe `localContext.now` y `localContext.timezone` desde el cliente. No usa el reloj del servidor para “hoy” o “mañana”.
- El contexto corto reutiliza `sessionId`, `lastSkill`, `lastResults`, `pendingClarification` y `pendingAction`.
- Las referencias internas y Google se revalidan por usuario antes de modificar; Google además se vuelve a leer antes de `patch/delete`.
- Las escrituras reutilizan el claim idempotente de Capability 1 y solo se ejecutan después de confirmación.

## 2. Estado de wake listening

- FARO Lab puede activar `wake listening` desde el control de STT Realtime; ya no requiere pulsar “Iniciar conversación” para cada sesión.
- En standby solo “Hola Faro” / “Hola, Faro” / “Oye Faro” abre la sesión. Audio ambiental transcrito se descarta antes de skills, contexto, LLM y TTS.
- Al despertar, ElevenLabs responde “Te escucho.” y los turnos posteriores se procesan automáticamente sin repetir la frase.
- “Adiós Faro” y variantes limpian historial, pending action/clarification y sessionId, responden brevemente y vuelven a standby sin apagar necesariamente Realtime.
- El Lab conserva un control explícito para apagar completamente STT Realtime.
- AEC, noise suppression y auto gain están solicitados al navegador. Barge-in está disponible como experimento opt-in; se deja apagado por defecto para evitar falsos cortes por audio del propio TTS.

## 3. Operaciones Calendar soportadas

Lecturas sin confirmación:

- `listCalendarItems`
- `getNextCommitment`
- `findCalendarEvent`
- `findAvailableSlots`

Escrituras con propuesta y confirmación:

- `createCalendarEvent`
- `updateCalendarEvent`
- `deleteCalendarEvent`
- `createScheduledTask`

Se soportan fecha/hora relativas, duración, evento vs tarea, referencias ordinales y deícticas (`la segunda`, `ahí`, `esa reunión`, `muévela`). La disponibilidad omite horarios pasados, recorre hasta siete días y ofrece hasta tres alternativas. Crear o mover primero comprueba conflictos combinando fuentes FARO y Google.

## 4. Soporte Google real implementado

- API: Events `list/get/insert/patch/delete` y FreeBusy.
- Escritura restringida al calendario seleccionado y a roles `writer`/`owner`.
- Inserciones de Voice usan un ID estable para que un retry no duplique el evento.
- `patch/delete` obtienen el recurso actual y usan ETag/`If-Match`; un cambio concurrente devuelve conflicto en lugar de sobrescribir silenciosamente.
- Las conexiones anteriores sin permiso de eventos reportan `reconnect_required`.
- Los fixtures del Lab viven en una tabla RLS separada y nunca reutilizan tokens/calendarios personales.

## 5. Scopes y permisos necesarios

- `https://www.googleapis.com/auth/calendar.events`
- `https://www.googleapis.com/auth/calendar.events.freebusy`
- `https://www.googleapis.com/auth/calendar.calendarlist.readonly`

No se solicita el scope amplio `calendar`. La conexión persiste los scopes efectivamente concedidos, el access role y si la escritura está habilitada.

## 6. Escenarios probados

El escenario remoto aislado prepara día parcial, día lleno, conflicto, evento FARO, fixture Google de 30 minutos, tarea y títulos similares. La secuencia verificada fue:

1. “¿Qué tengo mañana?” → 4 elementos.
2. “Encuéntrame un espacio de dos horas esta semana” → 3 alternativas.
3. “Pon ahí una tarea de dos horas para trabajar en FARO” → propuesta, confirmación y creación única.
4. “Mejor muévela a las 11 pm” → propuesta y actualización.
5. Evento a una hora ocupada → conflicto y alternativas.
6. “La segunda” → referencia correcta, propuesta y creación.
7. Movimiento del evento → propuesta y actualización.
8. “¿Qué sigue?” → siguiente compromiso encontrado en horizonte de siete días.

Resultado remoto final: todos los checks verdaderos y cero respuestas HTTP fallidas.

## 7. Métricas obtenidas

Benchmark remoto de 12 pasos contra `faro-voice` desplegado:

- Fast-path/lectura/propuesta Calendar: p50 ≈ 628 ms; p95 ≈ 2,146 ms (el p95 incluye cold start de la primera llamada).
- Confirmación/ejecución Calendar: p50 ≈ 660 ms; máximo ≈ 720 ms.
- Todas las rutas reportaron `skill=calendar` y nombres `fast_path:calendar:*` o `confirmed_server_action`.
- El tracing conserva auth, STT cliente, routing, `calendarContext`, `googleApi`, matching, `conflictDetection`, proposal, confirmation, execution, TTS playback y end-to-end. Las rutas probadas fueron deterministas; no se registró hit de LLM Calendar en este benchmark.

## 8. Pruebas automatizadas

- 42 archivos de prueba aprobados.
- 215 pruebas aprobadas.
- Cobertura añadida para intents Calendar, hora/duración/ordinal, referencia “ahí”, aislamiento frente a intents financieros, wake phrase, despedida, confirmación duplicada, FreeBusy y ETag.
- `npm run typecheck`: aprobado.
- `npm run lint`: aprobado.
- `npm run build`: aprobado.
- Edge Functions desplegadas y compiladas por Supabase: `faro-voice`, `faro-realtime-session`, `google-calendar-auth-start`, `google-calendar-callback`, `google-calendar-api`.
- Migración remota aplicada/verificada.

## 9. Limitaciones encontradas

- Wake listening usa transcripción Realtime continua y filtra localmente antes del pipeline FARO; evita contexto/LLM/TTS ambiental, pero todavía consume una sesión STT. Un wake-word engine local sería más económico en una futura iteración.
- Chrome/Safari requieren permiso activo de micrófono. Suspensión del equipo, cambio de dispositivo, ahorro de energía o throttling de pestañas en segundo plano puede detener WebRTC y exigir reactivación manual.
- Safari aplica restricciones más agresivas de autoplay/audio y background; el acknowledgement puede necesitar una interacción previa en algunas sesiones.
- Barge-in seguro depende de AEC/VAD del dispositivo. Por eso permanece experimental y opt-in.
- El flujo Google real está implementado y desplegado, pero la prueba automatizada usa fixtures para no tocar calendarios personales. Una cuenta existente debe reconectar y aceptar los scopes nuevos antes de una prueba manual de escritura.
- El entorno de Codex no expuso control de navegador/micrófono; se verificó `/lab` con HTTP 200 y el contrato remoto, pero la prueba acústica continua requiere ejecución manual en Chrome/Safari.

## 10. Pendientes antes de Capability 3

- Ejecutar una sesión acústica manual de aceptación en Chrome y Safari: wake → lectura → slot → tarea → confirmar → mover → confirmar → siguiente → goodbye.
- Reconectar una cuenta Google de prueba dedicada y validar insert/get/patch/delete/FreeBusy, rol de acceso y conflicto ETag 412.
- Medir wake false-positive/false-negative, consumo de sesión y estabilidad con pestaña en segundo plano.
- Decidir si el barge-in puede activarse por defecto tras medir auto-transcripción en dispositivos reales.
- Capability 3 Backlog Voice no fue abierta; no se añadió CRUD conversacional de Backlog ni se rediseñó ninguna vista.

## Referencias técnicas

- OpenAI Realtime VAD: https://developers.openai.com/api/docs/guides/realtime-vad#server-vad
- Google Calendar auth/scopes: https://developers.google.com/workspace/calendar/api/auth
- Google FreeBusy: https://developers.google.com/workspace/calendar/api/v3/reference/freebusy/query
- Google ETags: https://developers.google.com/calendar/api/guides/version-resources
- Google Events patch: https://developers.google.com/workspace/calendar/api/v3/reference/events/patch
