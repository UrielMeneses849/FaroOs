# FARO Voice MVP

La interfaz web establece audio con OpenAI Realtime mediante WebRTC. El SDP pasa por
`faro-realtime-session`, por lo que `OPENAI_API_KEY` nunca llega al navegador.
Las transcripciones se envían a `faro-voice`: esa función autentica al usuario,
limita el modelo a nueve herramientas con JSON Schema estricto, exige confirmación
para escrituras y opera Supabase con el JWT del usuario/RLS.

## Configuración

```bash
npx supabase secrets set OPENAI_API_KEY=...
npx supabase functions deploy faro-realtime-session
npx supabase functions deploy faro-voice
```

Opcionalmente pueden definirse `OPENAI_REALTIME_MODEL` y `OPENAI_TEXT_MODEL`.
No se guarda audio. `voice_action_logs` conserva intención, argumentos, confirmación
y resultado; `voice_preferences` conserva idioma, voz y aliases.

## Raspberry Pi

El cliente de Pi sólo necesita capturar/reproducir audio y autenticarse como usuario.
Debe reutilizar los mismos endpoints; nunca debe almacenar la clave de OpenAI ni
acceder a tablas con service role. Para modo kiosco: Chromium con HTTPS, micrófono
permitido para el origen y reinicio supervisado. La lógica operativa permanece en
las Edge Functions, así web y Pi comparten contratos, auditoría e idempotencia.

