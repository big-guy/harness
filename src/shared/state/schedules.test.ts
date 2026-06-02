import { describe, it, expect } from 'vitest'
import {
  initialSchedules,
  schedulesReducer,
  sanitizeSchedules,
  type Schedule
} from './schedules'

const mk = (id: string, over: Partial<Schedule> = {}): Schedule => ({
  id,
  title: `title ${id}`,
  at: '2026-07-01T09:00:00.000Z',
  repeat: 'once',
  prompt: `prompt ${id}`,
  target: { kind: 'repo', repoRoot: '/repo' },
  enabled: true,
  createdAt: '2026-06-01T00:00:00.000Z',
  ...over
})

describe('schedulesReducer', () => {
  it('loaded replaces the list', () => {
    const next = schedulesReducer(initialSchedules, {
      type: 'schedules/loaded',
      payload: [mk('a'), mk('b')]
    })
    expect(next.items.map((s) => s.id)).toEqual(['a', 'b'])
  })

  it('added appends a new schedule', () => {
    const next = schedulesReducer(initialSchedules, {
      type: 'schedules/added',
      payload: mk('a')
    })
    expect(next.items.map((s) => s.id)).toEqual(['a'])
  })

  it('added upserts an existing id in place', () => {
    const s1 = schedulesReducer(initialSchedules, {
      type: 'schedules/added',
      payload: mk('a', { title: 'first' })
    })
    const s2 = schedulesReducer(s1, {
      type: 'schedules/added',
      payload: mk('a', { title: 'second' })
    })
    expect(s2.items).toHaveLength(1)
    expect(s2.items[0].title).toBe('second')
  })

  it('updated patches an existing schedule and no-ops on a miss', () => {
    const s1 = schedulesReducer(initialSchedules, {
      type: 'schedules/loaded',
      payload: [mk('a'), mk('b')]
    })
    const s2 = schedulesReducer(s1, {
      type: 'schedules/updated',
      payload: mk('a', { title: 'patched' })
    })
    expect(s2.items[0].title).toBe('patched')
    // untouched entry keeps its reference
    expect(s2.items[1]).toBe(s1.items[1])

    const s3 = schedulesReducer(s1, {
      type: 'schedules/updated',
      payload: mk('missing')
    })
    expect(s3).toBe(s1)
  })

  it('removed drops a schedule and no-ops on a miss', () => {
    const s1 = schedulesReducer(initialSchedules, {
      type: 'schedules/loaded',
      payload: [mk('a'), mk('b')]
    })
    const s2 = schedulesReducer(s1, {
      type: 'schedules/removed',
      payload: { id: 'a' }
    })
    expect(s2.items.map((s) => s.id)).toEqual(['b'])

    const s3 = schedulesReducer(s1, {
      type: 'schedules/removed',
      payload: { id: 'missing' }
    })
    expect(s3).toBe(s1)
  })
})

describe('sanitizeSchedules', () => {
  it('drops invalid entries and dedups by id', () => {
    const clean = sanitizeSchedules([
      mk('a'),
      { id: 'a', title: 'dup', at: '2026-07-01T09:00:00.000Z', target: { kind: 'repo', repoRoot: '/r' } },
      { id: '', title: 'no id' },
      { id: 'b', title: '', at: '2026-07-01T09:00:00.000Z' },
      { id: 'c', title: 'bad date', at: 'not-a-date', target: { kind: 'repo', repoRoot: '/r' } },
      { id: 'd', title: 'no target', at: '2026-07-01T09:00:00.000Z' },
      mk('e', { target: { kind: 'worktree', worktreePath: '/wt', repoRoot: '/r' } })
    ])
    expect(clean.map((s) => s.id)).toEqual(['a', 'e'])
  })

  it('returns [] for non-arrays', () => {
    expect(sanitizeSchedules(null)).toEqual([])
    expect(sanitizeSchedules({})).toEqual([])
  })

  it('defaults repeat to once and enabled to true', () => {
    const [s] = sanitizeSchedules([
      {
        id: 'a',
        title: 't',
        at: '2026-07-01T09:00:00.000Z',
        target: { kind: 'repo', repoRoot: '/r' }
      }
    ])
    expect(s.repeat).toBe('once')
    expect(s.enabled).toBe(true)
  })
})
