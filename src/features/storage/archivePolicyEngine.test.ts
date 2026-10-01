import { describe, expect, it } from 'vitest'
import { recommendStorageLifecycle } from './archivePolicyEngine'

describe('Storage lifecycle policy', () => {
  it('hard-blocks sensitive files independently of their age or size', () => {
    expect(recommendStorageLifecycle({ name: '.env.production', bytes: 900_000_000, ageDays: 900, area: 'Escritorio' })).toMatchObject({ action: 'keep', protected: true })
  })

  it('archives large old packages only after a user chooses to do so', () => {
    expect(recommendStorageLifecycle({ name: 'release.zip', bytes: 800 * 1024 * 1024, ageDays: 40, area: 'Descargas' }).action).toBe('archive')
  })

  it('treats build outputs as cleanup rather than cloud archive candidates', () => {
    expect(recommendStorageLifecycle({ name: 'bundle.js', bytes: 100 * 1024 * 1024, ageDays: 50, area: 'Proyectos', path: '/Users/me/Projects/app/dist/bundle.js' }).action).toBe('clean')
  })

  it('does not infer that an ordinary old file is disposable', () => {
    expect(recommendStorageLifecycle({ name: 'ideas.txt', bytes: 2048, ageDays: 700, area: 'Documentos' }).action).toBe('review')
  })
})
