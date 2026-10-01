import { describe, expect, it } from 'vitest'
import { defaultComputerConfig, type ComputerConfig } from './computerTypes'
import { routeComputerVoiceCommand } from './computerRouter'

const config: ComputerConfig = {
  ...defaultComputerConfig(),
  projects: [{ id: 'faro', name: 'FARO OS', path: '/Users/test/FaroOS', editorApp: 'Visual Studio Code', urls: [], apps: [], workspaceName: 'FARO OS' }, { id: 'bimsa', name: 'BIMSA', path: '/Users/test/BIMSA', urls: [], apps: [], workspaceName: 'BIMSA' }],
  automations: [{ id: 'mode-bimsa', name: 'Modo BIMSA', trigger: { type: 'voice_phrase', phrase: 'modo BIMSA' }, conditions: {}, actions: [{ type: 'openProject', projectId: 'bimsa' }], enabled: true }],
}

describe('computer deterministic router', () => {
  it('opens an application without a model route', () => expect(routeComputerVoiceCommand('Faro, abre Spotify'.replace(/^Faro, /, ''), config)).toMatchObject({ kind: 'tool', tool: 'openApp', confirmationRequired: false }))
  it('removes transcription punctuation before handing an app name to macOS', () => expect(routeComputerVoiceCommand('Abre Spotify.', config)).toMatchObject({ kind: 'tool', tool: 'openApp', arguments: { app: 'Spotify' } }))
  it('recognizes Finder as an application', () => expect(routeComputerVoiceCommand('Abre Finder.', config)).toMatchObject({ kind: 'tool', tool: 'openApp', arguments: { app: 'Finder' } }))
  it('routes display controls without sending them to the model', () => {
    expect(routeComputerVoiceCommand('Sube el brillo de la pantalla', config)).toMatchObject({ kind: 'tool', tool: 'brightnessUp' })
    expect(routeComputerVoiceCommand('Pon el brillo máximo', config)).toMatchObject({ kind: 'tool', tool: 'setBrightness', arguments: { level: 'max' } })
    expect(routeComputerVoiceCommand('Activa Night Shift', config)).toMatchObject({ kind: 'tool', tool: 'setNightShift', arguments: { enabled: true } })
  })
  it('recognizes a registered project', () => expect(routeComputerVoiceCommand('Abre el proyecto de FARO', config)).toMatchObject({ kind: 'openProject', project: { id: 'faro' } }))
  it('keeps closing applications behind confirmation', () => expect(routeComputerVoiceCommand('Cierra Spotify', config)).toMatchObject({ kind: 'tool', tool: 'closeApp', confirmationRequired: true }))
  it('routes read-only app checks and a configured layout without a model', () => {
    expect(routeComputerVoiceCommand('Spotify está abierto', config)).toMatchObject({ kind: 'tool', tool: 'isAppRunning' })
    expect(routeComputerVoiceCommand('Lista aplicaciones abiertas', config)).toMatchObject({ kind: 'tool', tool: 'listRunningApps' })
  })
  it('extracts a focus duration and project deterministically', () => expect(routeComputerVoiceCommand('Voy a trabajar dos horas en BIMSA', config)).toMatchObject({ kind: 'startFocus', workspace: 'BIMSA', durationMinutes: 120 }))
  it('starts the 45-minute concentration mode from its spoken command', () => expect(routeComputerVoiceCommand('FARO, activa modo concentración', config)).toMatchObject({ kind: 'startFocus', workspace: 'Concentración', durationMinutes: 45 }))
  it('stops concentration explicitly instead of starting a new session', () => expect(routeComputerVoiceCommand('FARO, para el modo concentración', config)).toMatchObject({ kind: 'finishFocus' }))
  it('changes only the duration of the active concentration session', () => expect(routeComputerVoiceCommand('Cambia la duración de la concentración a 30 minutos', config)).toMatchObject({ kind: 'changeFocusDuration', durationMinutes: 30 }))
  it('runs a known voice phrase as a local automation', () => expect(routeComputerVoiceCommand('modo BIMSA', config)).toMatchObject({ kind: 'runAutomation', automation: { id: 'mode-bimsa' } }))
  it('proposes a taught local automation before it can be stored', () => expect(routeComputerVoiceCommand('Cuando me digas “modo BIMSA pro” quiero que abras VS Code con BIMSA y actives concentración', config)).toMatchObject({ kind: 'teachAutomation', automation: { trigger: { phrase: 'modo BIMSA pro' } } }))
  it('does not claim unrelated requests', () => expect(routeComputerVoiceCommand('¿Qué tengo mañana?', config)).toEqual({ kind: 'unhandled' }))
})
