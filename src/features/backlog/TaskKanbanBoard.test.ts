import { describe, expect, it } from 'vitest'
import type { Task } from '../../types'
import { groupCompletedTasks, sortCompletedTasks } from './TaskKanbanBoard'

const task = (id: string, completedAt?: string): Task => ({
  id,
  title: id,
  area: 'personal',
  status: 'done',
  priority: 'medium',
  createdAt: '2026-08-01T08:00:00.000Z',
  updatedAt: completedAt ?? '2026-08-01T08:00:00.000Z',
  completedAt,
})

describe('completed kanban tasks', () => {
  it('shows most recently completed tasks first', () => {
    const sorted = sortCompletedTasks([
      task('old', '2026-08-03T09:00:00.000Z'),
      task('new', '2026-08-08T18:00:00.000Z'),
      task('middle', '2026-08-05T12:00:00.000Z'),
    ])
    expect(sorted.map((item) => item.id)).toEqual(['new', 'middle', 'old'])
  })

  it('groups completed tasks by their close date while preserving descending order', () => {
    const groups = groupCompletedTasks([
      task('aug-3', '2026-08-03T09:00:00.000Z'),
      task('aug-8-late', '2026-08-08T18:00:00.000Z'),
      task('aug-8-early', '2026-08-08T08:00:00.000Z'),
    ])
    expect(groups.map((group) => group.key)).toEqual(['2026-08-08', '2026-08-03'])
    expect(groups[0]?.tasks.map((item) => item.id)).toEqual(['aug-8-late', 'aug-8-early'])
  })

  it('keeps legacy completed tasks visible under their latest update date', () => {
    const legacy = { ...task('legacy'), updatedAt: '2026-08-07T10:00:00.000Z' }
    const groups = groupCompletedTasks([task('new', '2026-08-08T10:00:00.000Z'), legacy])
    expect(groups.map((group) => group.key)).toEqual(['2026-08-08', '2026-08-07'])
  })

  it('recovers ordering and labels from updatedAt when a legacy migration stamped one shared close time', () => {
    const migrationStamp = '2026-08-30T18:00:00.000Z'
    const recovered = [
      { ...task('jul-28', migrationStamp), updatedAt: '2026-07-28T17:00:00.000Z' },
      { ...task('aug-12', migrationStamp), updatedAt: '2026-08-12T09:00:00.000Z' },
      { ...task('aug-12-late', migrationStamp), updatedAt: '2026-08-12T19:00:00.000Z' },
      { ...task('aug-3', migrationStamp), updatedAt: '2026-08-03T12:00:00.000Z' },
      ...Array.from({ length: 6 }, (_, index) => ({
        ...task(`legacy-${index}`, migrationStamp), updatedAt: '2026-07-19T12:00:00.000Z',
      })),
    ]

    expect(sortCompletedTasks(recovered).slice(0, 4).map((item) => item.id)).toEqual(['aug-12-late', 'aug-12', 'aug-3', 'jul-28'])
    expect(groupCompletedTasks(recovered).map((group) => group.key)).toEqual(['2026-08-12', '2026-08-03', '2026-07-28', '2026-07-19'])
  })

  it('does not label an untraceable migration batch as if it closed that day', () => {
    const migrationStamp = '2026-08-30T18:00:00.000Z'
    const legacyBatch = Array.from({ length: 10 }, (_, index) => ({
      ...task(`legacy-${index}`, migrationStamp), updatedAt: migrationStamp,
    }))
    const groups = groupCompletedTasks([
      ...legacyBatch,
      task('real-close', '2026-09-01T16:00:00.000Z'),
    ])

    expect(groups.map((group) => group.key)).toEqual(['2026-09-01', 'unknown'])
    expect(groups[1]).toMatchObject({ label: 'Histórico sin fecha de cierre' })
    expect(sortCompletedTasks([...legacyBatch, task('real-close', '2026-09-01T16:00:00.000Z')])[0]?.id).toBe('real-close')
  })
})
