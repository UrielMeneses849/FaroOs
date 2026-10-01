# FARO Voice — Capability 1: Performance + CRUD financiero

Fecha de validación: 8 de agosto de 2026.

## Alcance entregado

La ruta productiva de FARO Voice conserva ElevenLabs como única voz de salida y limita esta capability al dominio financiero. Calendar Voice y Backlog Voice no se incorporaron.

Pipeline optimizado:

1. Web Speech o texto captura la instrucción y crea `requestId`, `traceId` y `sessionId`.
2. El Edge Function enruta `skill -> intent -> entities` antes de solicitar contexto.
3. Los intents financieros simples usan fast paths deterministas y consultan sólo las cuentas, categorías, transacciones o recurrencias necesarias.
4. Las escrituras generan una propuesta pendiente; nunca se ejecutan desde el cliente.
5. La confirmación reclama atómicamente la acción persistida mediante `claim_voice_action` y reutiliza los RPC financieros existentes.
6. La respuesta se transmite desde ElevenLabs cuando el navegador admite Media Source Extensions; de lo contrario se repite la petición mediante el fallback Blob.
7. Las marcas cliente y servidor se consolidan en `voice_action_logs.timings` para FARO Lab.

El LLM queda reservado para instrucciones fuera de los fast paths, ambigüedades que no puedan resolverse con candidatos deterministas y peticiones que requieran razonamiento semántico.

## Fast paths financieros

- Crear gasto.
- Crear ingreso.
- Consultar “gastado hoy”.
- Buscar y resolver candidatos de movimientos.
- Actualizar categoría o importe de un movimiento.
- Eliminar un movimiento.
- Registrar una ocurrencia recurrente.
- Resolver referencias cortas de sesión, por ejemplo `el segundo`, `cambia ese` y `elimínalo`.

El contexto corto se mantiene en cliente durante la sesión con `lastSkill`, `lastResults`, `pendingClarification` y `pendingAction`. El servidor valida todas las entidades y conserva las escrituras exclusivamente server-side.

## Baseline y retest

Benchmark remoto sobre los mismos siete escenarios, tres repeticiones por escenario (`n=21` por pipeline):

| Métrica | Legacy p50 | Legacy p95 | Optimizado p50 | Optimizado p95 | Mejora p50 |
| --- | ---: | ---: | ---: | ---: | ---: |
| Instrucción -> propuesta | 9,566.36 ms | 15,093.18 ms | 613.59 ms | 805.77 ms | 93.6% |
| Tiempo total servidor | 9,015.86 ms | 14,390.10 ms | 228.10 ms | 309.79 ms | 97.5% |

Los 21 casos legacy usaron el fallback LLM. Los 21 casos optimizados terminaron por rutas deterministas. El baseline conserva deliberadamente la espera histórica de 250 ms sólo como variante comparativa de FARO Lab; la ruta productiva no la ejecuta.

Escenarios repetidos:

- `Gasté 350 en comida.`
- `Registra 1200 de ingreso en BBVA.`
- `¿Cuánto gasté hoy?`
- `Elimina el gasto de 500 de ayer.`
- `Cambia el gasto de 350 a Transporte.`
- `Registra el pago de Renta.`
- `Elimina ese gasto.`

## TTS

Benchmark remoto con diez muestras por modelo y streaming habilitado:

| Modelo | Primer byte p50 | Primer byte p95 | Descarga p50 | Descarga p95 |
| --- | ---: | ---: | ---: | ---: |
| `eleven_multilingual_v2` | 822.24 ms | 2,657.78 ms | 894.86 ms | 2,698.65 ms |
| `eleven_flash_v2_5` | 589.55 ms | 690.33 ms | 666.06 ms | 1,052.00 ms |

Flash redujo 28.3% la mediana hasta el primer byte en esta muestra. El modelo actual continúa siendo el predeterminado porque la calidad perceptual requiere evaluación humana; Flash permanece como variante A/B en FARO Lab.

`audioPlaybackStartMs`, `ttsTotalMs` y el total end-to-end se registran durante reproducción real en el navegador. El benchmark Node sólo reporta primer byte y descarga, por lo que no atribuye tiempos de reproducción no observados.

## STT y turnos

- Web Speech registra proveedor, primer resultado y resultado final.
- FARO Lab ofrece una ruta experimental OpenAI Realtime para STT y Server VAD.
- La sesión Realtime solicita sólo texto y descarta cualquier pista de salida; ElevenLabs continúa siendo la única voz de FARO.
- Se registran conexión, duración del turno y tiempo desde inicio de voz hasta transcripción final.

No se declara una comparación numérica STT sin una captura real de micrófono equivalente en el mismo navegador y entorno. FARO Lab queda preparado para obtenerla sin sustituir el STT productivo.

## Idempotencia y CRUD

La prueba remota concurrente confirmó:

- Un solo movimiento después de dos confirmaciones simultáneas de creación.
- La actualización terminó en la categoría Transporte.
- Cero movimientos restantes después de eliminar y volver a confirmar.
- Una sola ocurrencia recurrente pagada después de dos confirmaciones simultáneas.
- Cero errores HTTP 5xx en la muestra.

Los códigos `200/409` o los replays `200/200` son resultados válidos de la carrera: una petición ejecuta o completa la acción y la otra recibe el estado ya reclamado/completado sin duplicar la escritura. Una ejecución fallida deja una ruta recuperable con lease y contador de intentos.

## Validación automatizada

- TypeScript: `npm run typecheck`.
- ESLint: `npm run lint`.
- Vitest: suite completa.
- Build de producción: `npm run build`.
- Benchmark reproducible: `node --env-file=.env.local scripts/voice-capability1-benchmark.mjs`.
- Migraciones aplicadas y Edge Functions `faro-voice`, `faro-speech` y `faro-realtime-session` desplegadas.

## Riesgos antes de Calendar Voice

- Ejecutar el benchmark STT comparativo con el mismo hablante, micrófono, frases y condiciones de red; medir p50/p95 sólo después de reunir una muestra suficiente.
- Realizar evaluación perceptual ciega de ElevenLabs actual frente a Flash antes de cambiar el modelo predeterminado.
- Validar barge-in completo en navegador: la infraestructura STT/VAD está preparada, pero la interrupción de reproducción todavía no se promueve a comportamiento productivo.
- Revisar retención y volumen de `timings`/metadata cuando exista tráfico real sostenido.
- Antes de abrir Calendar, crear sus intents y autorizaciones sobre el mismo router sin reutilizar reglas financieras ni ampliar silenciosamente los permisos de escritura.
