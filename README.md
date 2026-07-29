# FARO OS v0.1

FARO OS es un sistema operativo personal, local y privado para convertir objetivos en proyectos, proyectos en tareas y tareas en días con dirección. También reúne aprendizaje, finanzas, salud, tratamiento y diario sin depender de una cuenta o servicio externo.

## Objetivo

Reducir el ruido operativo de la vida diaria y mantener un sistema confiable para capturar, organizar, ejecutar y revisar lo importante.

## Stack

- React 19, Vite y TypeScript estricto.
- React Router.
- Zustand con persistencia versionada en `localStorage`.
- Zod para captura, importación y respaldos.
- Tailwind CSS y CSS del design system FARO.
- Framer Motion, Lucide React y Poppins.
- date-fns y Recharts.
- Vitest, React Testing Library y jsdom.

## Instalación

Requiere una versión de Node.js compatible con Vite 8.

```bash
npm install
npm run dev
```

## Scripts

```bash
npm run dev        # servidor local
npm run lint       # ESLint
npm run typecheck  # TypeScript sin emitir archivos
npm test           # suite Vitest
npm run build      # bundle de producción
npm run preview    # vista previa del build
```

## Arquitectura

```text
src/
├── app/          # router, navegación y rutas diferidas
├── components/   # design system y layout
├── data/         # datos demo
├── features/     # captura, backlog, dashboard y planificación
├── hooks/        # hooks transversales
├── lib/          # métricas, respaldo, validación y utilidades
├── pages/        # páginas de dominio
├── store/        # acciones, selectores y persistencia
├── test/         # configuración de pruebas
└── types/        # contratos del dominio
```

Los dominios se conservan separados, pero comparten relaciones por identificadores. El progreso nunca se guarda manualmente: se deriva de las tareas.

## Modelo de datos

- `Goal → Project → Task`.
- Una tarea también puede relacionarse directamente con un objetivo.
- `Idea` puede convertirse en tarea, proyecto u objetivo.
- `StudySession`, `Transaction`, `HealthLog`, `TreatmentLog` y `JournalEntry` pertenecen al usuario local.
- Las eliminaciones de objetivos o proyectos desacoplan relaciones; no eliminan tareas silenciosamente.

## Funcionalidades

- Dashboard conectado con métricas, tendencias e insights locales sin IA.
- Vista Hoy con prioridades, vencidas, tiempo estimado y cierre diario.
- Captura rápida global y Backlog universal.
- Objetivos y proyectos con detalles, relaciones y progreso automático.
- Tareas completables, editables y posponibles.
- Registros de aprendizaje, finanzas, salud e isotretinoína.
- Diario con búsqueda y plantilla FARO.
- Configuración con exportación, importación, restauración demo y borrado reforzado.
- Estados “Próximamente” para Sprints, Calendario, Nexvora, Portafolio, Ventas, Contenido y Europa.

## Atajos

- `Cmd + K` en macOS.
- `Ctrl + K` en Windows y Linux.
- `Escape` cierra diálogos.
- Los modales conservan el foco dentro del diálogo y lo devuelven al elemento anterior.

## Persistencia y respaldo

Los datos se guardan automáticamente bajo la clave `faro-os-data`. El esquema actual es la versión 4 e incluye migraciones básicas para versiones anteriores.

La hidratación ignora JSON corrupto y estados con una forma incompatible. Desde `/settings` es posible:

- exportar un respaldo JSON;
- importar un respaldo v0.1 validado con Zod;
- restaurar datos demo;
- borrar todos los datos mediante confirmación reforzada.

Los respaldos contienen información personal. Deben almacenarse en un lugar privado.

## FARO Voice

El acceso global **Hablar con FARO** admite texto y audio WebRTC. Las sesiones de
OpenAI y las herramientas operativas viven en Supabase Edge Functions; ninguna
clave privada se entrega al navegador y toda escritura requiere confirmación.
Consulta [docs/FARO_VOICE.md](docs/FARO_VOICE.md) para configuración, auditoría y
la futura instalación en Raspberry Pi.

## Pruebas

La suite cubre captura, conversiones, relaciones, progreso, Hoy, registros personales, persistencia, corrupción local, respaldos y accesibilidad de modales.

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

## Limitaciones conocidas

- Los datos existen únicamente en el navegador actual.
- No hay autenticación, sincronización, colaboración ni cifrado de respaldos.
- Los registros personales son principalmente append-only en v0.1.
- No existe gestión avanzada de recurrencias, subtareas o calendario.
- El bundle base aún supera 500 kB; las rutas con gráficas ya usan lazy loading.
- El registro de isotretinoína es informativo y no sustituye indicaciones médicas.

## Roadmap

1. Reducir el bundle base y añadir error boundaries por ruta.
2. Completar edición y eliminación avanzada de registros personales.
3. Añadir sprints, calendario y recurrencias.
4. Construir módulos Nexvora, Portafolio, Ventas, Contenido y Europa.
5. Incorporar sincronización opcional y experiencia offline instalable.

## Preparación para Supabase

Antes de conectar Supabase será necesario:

- convertir IDs locales en UUID estables compatibles con Postgres;
- definir tablas, claves foráneas e índices por dominio;
- añadir `user_id`, timestamps de servidor y políticas RLS;
- separar repositorios de datos de las acciones Zustand;
- diseñar resolución de conflictos entre estado local y remoto;
- cifrar y proteger datos sensibles;
- versionar migraciones de base de datos;
- implementar autenticación y exportación/eliminación de cuenta;
- mantener un modo local-first durante fallos de red.

Supabase no está incluido en v0.1.
