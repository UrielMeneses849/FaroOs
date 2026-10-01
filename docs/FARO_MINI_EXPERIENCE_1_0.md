# FARO Mini Experience 1.0

Implementación de Desktop UX/runtime. No se modificaron Edge Functions, modelos ni reglas de negocio de confirmación. El despliegue utiliza la misma identidad local de firma de FARO.

## 1. Arquitectura anterior

`src/desktop/FaroMini.tsx` mezclaba snapshots, estado del micrófono, menús, Concentración, reloj y tres temporizadores. `main.rs` decidía tamaños por separado: 400×372 normal, 400×470 confirmación, 368×304 Focus y 174×168 Focus pequeño. Cada snapshot ejecutaba `resize_mini` y volvía a anclar la ventana al monitor de la ventana principal.

## 2. Fallos encontrados

- Reposo con una tarjeta grande, controles y transcripción.
- Redimensionamiento y recolocación incluso ante snapshots sin cambios de presentación.
- Arrastre perdido al llegar el siguiente snapshot.
- Dos autoridades distintas para el tamaño: voz y Focus.
- Focus se contraía a los 1.350 ms o 360 ms al salir, sin comprobar todos los bloqueos.
- Suscripciones asíncronas podían terminar de registrarse después del desmontaje.
- El reloj actualizaba el componente completo cada segundo aun sin Focus.
- Tauri `show()` en macOS utiliza `makeKeyAndOrderFront`; omitir `set_focus()` no basta para mostrar pasivamente.
- Voice publica `listening` también al esperar la palabra FARO. Mini necesita distinguir esa espera de una orden activa.
- Durante QA nativa se detectó que `set_size()` puede devolver el control antes de actualizar `outer_size()`. Calcular posición con esa lectura anterior sacaba el panel de pantalla. La versión final posiciona con las dimensiones solicitadas.

## 3. Arquitectura nueva

| Pieza | Responsabilidad |
| --- | --- |
| `mini/MiniStateMachine.ts` | Única fuente de estado visual, locks y temporizadores. |
| `mini/MiniInteractionController.ts` | Eventos nativos, cursor, teclado, menú y arrastre. |
| `mini/MiniWindowController.ts` | Solicitudes de presentación serializadas; conserva sólo el último destino pendiente. |
| `src-tauri/src/mini.rs` | Tamaños, geometría, monitores, persistencia, menú y click-through. |
| `src-tauri/src/mini_window.m` | Mostrar sin activar la app y lectura de botones del mouse. Usa AppKit ya disponible; sin dependencia nueva. |
| `mini/MiniView.tsx` | Orb, resumen de voz, propuesta y controles de Focus. |
| `mini/useMiniFocus.ts` | La sesión existente y su transición de fase al vencimiento. |
| `mini/MiniErrorBoundary.tsx` | Recuperación a un Orb, sin restaurar contenido visual antiguo. |
| `mini/MiniMetrics.ts` | Muestras numéricas locales, acotadas y sin transcripciones. |

`FaroMini.tsx` conecta estas piezas con los servicios existentes. Mini deja de importar el CSS completo de la aplicación principal.

## 4. State machine

Estados: `ambient`, `peek`, `listening`, `understanding`, `consulting`, `awaiting_confirmation`, `executing`, `speaking`, `success`, `focus_compact`, `focus_expanded`, `error`.

Flujos principales:

```text
ambient → peek → ambient
ambient → listening → understanding → speaking → success → ambient
understanding → consulting (si la operación supera 300 ms)
voice → awaiting_confirmation → executing → speaking/success
focus_expanded → focus_compact → voice → success → focus_compact
error → ambient / focus_compact
```

La espera de la palabra de activación vuelve a la presentación base sin detener el Core. Understanding conserva unos 200 ms visuales; Success dura al menos 1.200 ms; Error puede contraerse tras 5 segundos. Estas esperas sólo afectan la presentación.

## 5. Window lifecycle

Se conserva un único label `mini`. Los estados cambian esa misma ventana. Cerrar main mantiene el proceso; ocultar Mini no la destruye. El controlador la recupera ante una destrucción excepcional. Se mantienen tray, single-instance y ⌘⇧Space. La ventana normal empieza en 80×80.

El atajo restaura Mini si está oculta, invoca desde Ambient/Focus compacto y contrae una expansión simple. Si está escuchando, solicita detener la escucha por el canal existente. Los bloqueos de confirmación, ejecución y habla tienen prioridad sobre una contracción manual.

## 6. Pointer zones

Geometría global del cursor en coordenadas nativas, con escala de pantalla. CORE es el círculo del Orb en Ambient y el interior del panel expandido. NEAR añade 24 puntos por lado: aproximadamente 128×128 alrededor del Orb. FAR queda fuera de esa región.

Un único observador nativo consulta a 12,5 Hz y emite sólo cuando cambia zona, botones, arrastre, menú o geometría. La topología de monitores se comprueba cada 2 segundos; React no hace polling de cursor ni pantallas.

## 7. Hover intent

Entrar en NEAR/CORE espera 180 ms. Un paso rápido no abre Peek. El foco compacto usa el mismo mecanismo para revelar controles. Durante un arrastre, botón presionado o menú, no se abre otra presentación por hover.

## 8. Collapse logic

FAR inicia 600 ms; volver a NEAR/CORE cancela la contracción. `canAutoCollapse()` exige ausencia de locks: pointer inside, pointer pressed, control focused, dragging, menu open, pending confirmation, speaking, listening, executing y focus config. Understanding y Consulting también se mantienen mientras la operación está activa.

ESC contrae una expansión simple o los controles de Focus. No cancela acciones pendientes ni la sesión de Focus. Auto-collapse está activado por defecto; auto-hide no existe como comportamiento automático. “Ocultar Mini” es una acción explícita.

## 9. Focus

Reutiliza la sesión de Computer y los mismos controles: iniciar, pausar/reanudar, descansar y cancelar. No crea un segundo temporizador de negocio. El reloj visual se actualiza dentro de su propio componente; la transición de fase se programa para el vencimiento real.

Una sesión recién iniciada muestra controles durante unos 3 segundos sin interacción. Compacto muestra Orb y reloj. Voice toma temporalmente la superficie; al terminar se vuelve a la misma sesión. Se conserva una sesión ya activa al arrancar o reiniciar la app.

## 10. Voice

Mini no solicita `getUserMedia`. El stream, STT y TTS siguen perteneciendo al Voice existente. `waitingForWake` es metadato de presentación del snapshot; no cambia la semántica del Core.

El medidor observa el stream ya abierto con un AnalyserNode opcional. Publica nivel RMS cada 80 ms y actualiza una variable CSS, sin snapshots semánticos ni render de React por cada nivel. Si Web Audio falla, se desactiva sólo el observador, sin detener tracks ni Voice. La animación de habla es visual; no se presenta como medición del audio de salida.

El click explícito y el atajo utilizan la ruta existente de escucha inmediata: no obligan a repetir la palabra de activación después de pulsar el Orb.

Transcripción y respuesta se limitan visualmente a dos líneas. “Ver conversación” abre el historial existente en FARO.

## 11. Confirmaciones

Se usa la misma `pendingAction`, sin construir una copia persistida. Los botones envían `requestFaroVoiceAction('confirm'/'cancel')`, que ya llega al resolver existente de `voiceService.confirm/cancel` y al resolver local correspondiente cuando aplica.

La propuesta no desaparece por hover, ESC o una nueva invocación. Durante ejecución los botones se bloquean. Al cambiar de presentación se libera el lock del control que desaparece, evitando que una confirmación por teclado impida la contracción posterior. Las respuestas de voz “sí” y “cancela” siguen usando la ruta existente. Las pruebas no registran movimientos reales.

## 12. Monitores y posición

Al invocar, el monitor que contiene el cursor tiene prioridad. Fuera de invocaciones se conserva el monitor elegido; no se persigue el foco de otras apps. Se utilizan `work_area`, escala, margen derecho de 24 puntos y margen superior de 16 puntos.

Se persisten nombre de monitor y posición relativa, no sólo coordenadas absolutas. Si la pantalla guardada desaparece, se usa la disponible y se vuelve a la esquina superior derecha. Los cambios de escala y topología recalculan límites. Arrastrar desde el Orb guarda la posición y ajusta a los bordes si se suelta dentro del 6% extremo de cada eje. No hay animación de tamaño nativo por frame.

## 13. Prevención de robo de foco

Las apariciones pasivas llaman a `orderFrontRegardless` y no activan NSApplication. Mini no es focusable en Ambient/Focus compacto. Sólo un control pulsado explícitamente habilita el foco de teclado. Abrir FARO desde el menú es una acción explícita que sí activa main.

Click-through es una aproximación por región: el observador nativo alterna `ignore_cursor_events` en el margen transparente de Ambient. No es una máscara de píxel; puede haber hasta un intervalo de observación antes de que cambie la captura.

## 14. Performance antes/después

| Observación | Antes | Después | Evidencia |
| --- | --- | --- | --- |
| Ventana en reposo | 400×372 | 80×80 | Presets; reducción de área del 95,7%, no una medición de CPU. |
| 100 snapshots equivalentes | El handler llamaba resize/anclaje en cada snapshot | 0 resizes desde el handler de snapshots; 1 petición inicial del controlador | Inspección del código anterior y prueba de 100 eventos. |
| 100 actualizaciones sólo de nivel | Entraban por el snapshot de React | 0 publicaciones del store visual | Test de la máquina. |
| Reloj sin Focus | Intervalo permanente en todo Mini | Ningún intervalo de reloj | Arquitectura nueva. |
| Estilos propios cargados por Mini | Importaba `index.css` (388.148 B) más la hoja Mini anterior (13.370 B) | Hoja Mini independiente, unos 5,5 KB de fuente | Tamaños de fuente, no tamaño de descarga comprimido. |
| Geometría durante expansión | Se leía el tamaño anterior al resize | Se usa el tamaño de destino | Fallo encontrado en QA real y corregido. |

No se obtuvo una captura de latencia nativa del Mini anterior: no estaba abierto en la consulta inicial. No se afirma una mejora medida de CPU, GPU, energía o latencia end-to-end de Voice.

Instrumentación: `stateTransitions`, `windowResizeMs`, `renderMs`, `hoverToPeekMs`, `farToCollapseMs`, `wakeToVisibleListeningMs`. Se guardan hasta 500 muestras numéricas en memoria. `windowResizeMs` mide las llamadas nativas, no el compositor; wake-to-visible aproxima el primer frame de React tras recibir la activación, no la latencia del detector.

En desarrollo: ejecutar `FARO_MINI_DEBUG=1 npm run tauri:dev`. El overlay muestra estado, locks, zona, estado de Voice/Focus y timers; la consola añade geometría nativa. `window.faroMiniMetrics()` devuelve las muestras desde el inspector de Mini. No hay overlay en producción ni logs de transcripciones.

## 15. Tests

Suite completa frontend: 453 pruebas en 73 archivos. Suite nativa: 15 pruebas, incluidas 6 de Mini. Las pruebas de Mini incluyen hover intent, cancelación de collapse, locks, prioridades de Voice, mínimos visuales, standby de wake, Focus, errores, shortcut, StrictMode, limpieza de listeners, confirmación sin duplicación, recuperación y observación no invasiva del audio.

TypeScript y ESLint sobre los archivos modificados pasan. Las comprobaciones de geometría cubren pantallas con origen negativo, Retina, reducción de resolución, recuperación offscreen y persistencia relativa.

## 16. Build

`npm run tauri:build` genera `src-tauri/target/release/bundle/macos/FARO.app`. Se usaron las dependencias nativas existentes. Los avisos de APIs antiguas de Keychain corresponden al código existente de Vault.

## 17. Instalación

Instalada y abierta en `/Applications/FARO.app` el 7 de septiembre de 2026. Firma con `FARO Local Development`; `codesign --verify --deep --strict` confirmó integridad y Designated Requirement. La compilación instalada incluye los últimos ajustes de confirmación por teclado y escucha explícita.

## 18. Límites de la verificación

Las pruebas automatizadas de monitores no sustituyen desconectar físicamente un segundo monitor. El nombre de pantalla es el identificador expuesto por Tauri y puede no ser único entre pantallas idénticas. La detección de topología es por consulta nativa de baja frecuencia, no por callback de conexión.

Wake requiere que el Core existente esté armado; esta capability no vuelve a habilitar el modelo legacy “Hola FARO” desactivado por la configuración anterior. No se añadió un segundo dueño del micrófono. El ciclo hablado completo y una confirmación financiera real requieren la comprobación del usuario; no se crearon gastos para probar la UI.

## 19. QA manual reproducible

QA nativa ejecutada sobre la app instalada, consultando WindowServer y desplazando el cursor:

| Presentación | Posición lógica | Tamaño lógico |
| --- | --- | --- |
| Ambient | 1366, 49 | 80×80 |
| Peek | 1256, 49 | 190×90 |
| Ambient tras alejarse | 1366, 49 | 80×80 |

Las tres fases conservaron el ID de ventana 1535 y el borde derecho en 1446, a 24 puntos del borde de una pantalla de 1470. Chrome permaneció como aplicación activa durante una pasada y VS Code durante otra. Mini siguió viva cuando main dejó de estar visible.

En la pasada previa con una sesión de Concentración existente, se comprobó 150×170 → 320×238 → 150×170 y la conservación del ancla derecha, sin cancelar ni reiniciar la sesión. Se inspeccionó visualmente el reloj compacto. Las capturas de paneles expandidos por ventana devolvieron un recorte inconsistente con los bounds de WindowServer; las capturas por región quedaron tapadas por otras ventanas/notificaciones. Por ello la revisión visual completa de los paneles expandidos queda pendiente y no se presenta una captura recortada como evidencia de aprobación visual.

Pasos restantes y de repetición:


1. Sin una sesión de Focus activa, iniciar FARO y comprobar Orb en reposo. Si ya hay Focus, debe reaparecer su timer.
2. Mantener VS Code activo; acercarse al Orb, esperar Peek y alejarse. Comprobar que VS Code no pierda foco.
3. Arrastrar desde el Orb, soltar y reiniciar: debe conservar el ancla relativa.
4. Click derecho: probar Concentración, enlaces a Finanzas/Calendario/Backlog/Ajustes, Mantener visible y las preferencias de movimiento/contracción.
5. Con Voice armado, decir FARO, dar una consulta, escuchar y comprobar vuelta al Orb.
6. Dar una orden con propuesta; alejar el cursor y pulsar ESC: la propuesta debe continuar. Resolver una vez por botón y otra por voz con datos de prueba apropiados.
7. Iniciar Focus de 45 minutos; esperar compacto, acercarse, pausar/reanudar y usar Voice. El tiempo y la sesión deben conservarse.
8. Probar ⌘⇧Space desde Orb, una expansión simple y Mini oculta. No debe crear otra ventana.
9. En dos pantallas, invocar en A y B; desconectar B, cambiar escala/resolución y verificar que siga dentro del área visible.


## Ajuste de uso — acceso a Concentración y estado real del micrófono

Se recuperó un botón directo «Concentración» en Peek (al acercarse al Orb), conectado al controlador silencioso existente. Peek mide ahora 240×100. No requiere menú contextual ni activación de Voice.

Mini distingue apertura del micrófono, negociación de voz y conexión activa mediante `inputStatus` del Core. «Te escucho» y el medidor sólo aparecen con conexión activa; el botón de detener usa un cuadrado para evitar confundirlo con un micrófono deshabilitado. La presentación de escucha mide 300×190 para dar espacio al estado, avisos y transcripción.

La apertura completa tiene un límite de 20 segundos, incluyendo permisos y negociación, además de recuperación visual si el Core no responde a la invocación. Una solicitud de micrófono que se resuelva después de cancelar o vencer se libera inmediatamente. La denegación de permiso muestra la ruta de ajustes de macOS. Los avisos de transcripción se muestran en Mini en vez de ignorarse.

Esto corrige la falsa indicación de escucha y la espera indefinida; no demuestra por sí solo cuál fue la causa ambiental de la captura fallida reportada. El reconocimiento hablado en el dispositivo requiere una comprobación real después de instalar.

Validación de esta revisión: 456 pruebas frontend en 74 archivos, 15 pruebas nativas, TypeScript y ESLint de los archivos modificados aprobados. Build Tauri completado.

## Corrección de firma y permiso de audio

Se comprobó que la app instalada tenía Hardened Runtime (`flags=0x10000`) y `NSMicrophoneUsageDescription`, pero ninguna entitlement de entrada de audio. Se añadió `com.apple.security.device.audio-input=true` a `src-tauri/Entitlements.plist`, a la configuración de bundle de Tauri y al script de firma local. El script comprueba además que la clave esté presente en el artefacto firmado, para evitar que una reinstalación vuelva a omitirla.

Referencia de Apple: https://developer.apple.com/documentation/BundleResources/Entitlements/com.apple.security.device.audio-input . La entitlement habilita la solicitud de audio; el consentimiento del usuario sigue siendo gestionado por macOS. No se restableció ni modificó la base de permisos del sistema.
