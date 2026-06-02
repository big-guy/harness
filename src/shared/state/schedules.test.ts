import { describe, it, expect } from 'vitest'
import {
  initialSchedules,
  schedulesReducer,
  sanitizeSchedules,
  nextOccurrence,
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

  it('returns null for one-time schedules', () => {
    expect(nextOccurrence('2026-07-01T09:00:00.000Z', 'once', Date.now())).toBeNull()
  })

  it('daily steps to the next future day at the same time', () => {
    const at = '2026-07-01T09:00:00.000Z'
    const now = Date.parse('2026-07-03T10:00:00.000Z') // missed 1st, 2nd, 3rd(9am)
    const next = nextOccurrence(at, 'daily', now)
    expect(next).not.toBeNull()
    expect(new Date(next!).getTime()).toBeGreaterThan(now)
    // lands on the 4th at 09:00 UTC
    expect(next).toBe('2026-07-04T09:00:00.000Z')
  })

  it('weekly steps by 7 days', () => {
    const at = '2026-07-01T09:00:00.000Z'
    const now = Date.parse('2026-07-05T00:00:00.000Z')
    expect(nextOccurrence(at, 'weekly', now)).toBe('2026-07-08T09:00:00.000Z')
  })

  it('weekdays never lands on a weekend', () => {
    // 2026-07-03 is a Friday; next weekday after Fri is Mon 2026-07-06.
    const at = '2026-07-03T09:00:00.000Z'
    const now = Date.parse('2026-07-03T12:00:00.000Z')
    const next = nextOccurrence(at, 'weekdays', now)!
    const day = new Date(next).getDay()
    expect(day).not.toBe(0)
    expect(day).not.toBe(6)
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
