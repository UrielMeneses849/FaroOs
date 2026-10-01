import { describe, expect, it } from 'vitest'
import { computerToolDefinition, computerToolRegistry } from './computerTypes'

describe('Computer tool registry safety contract', () => {
  it('does not expose a destructive or shell tool in V1', () => {
    expect(computerToolRegistry.some((tool) => tool.safetyLevel === 3)).toBe(false)
    expect(computerToolRegistry.map((tool) => tool.name)).not.toContain('runShell')
    expect(computerToolRegistry.map((tool) => tool.name)).not.toContain('deleteFile')
  })
  it('requires confirmation for system actions that can interrupt work', () => {
    expect(computerToolDefinition('closeApp')).toMatchObject({ safetyLevel: 2, confirmationRequired: true })
    expect(computerToolDefinition('lockComputer')).toMatchObject({ safetyLevel: 2, confirmationRequired: true })
  })
  it('keeps common volume and app opening deterministic and reversible', () => {
    expect(computerToolDefinition('openApp')).toMatchObject({ safetyLevel: 1, confirmationRequired: false })
    expect(computerToolDefinition('setVolume')).toMatchObject({ safetyLevel: 1, confirmationRequired: false })
    expect(computerToolDefinition('setBrightness')).toMatchObject({ safetyLevel: 1, confirmationRequired: false })
  })
})
