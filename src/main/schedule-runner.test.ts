import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Store } from './store'
import { initialState } from '../shared/state'
import type { Schedule } from '../shared/state/schedules'
import type { Worktree } from '../shared/state/worktrees'
import { ScheduleRunner } from './schedule-runner'

const NOW = Date.parse('2026-07-01T12:00:00.000Z')

const mk = (over: Partial<Schedule> = {}): Schedule => ({
  id: over.id ?? 'a',
  title: 'title',
  at: '2026-07-01T09:00:00.000Z', // in the past relative to NOW
  repeat: 'once',
  prompt: 'do the thing',
  target: { kind: 'repo', repoRoot: '/repo' },
  enabled: true,
  createdAt: '2026-06-01T00:00:00.000Z',
  ...over
})

function storeWith(schedules: Schedule[], worktrees: Worktree[] = []): Store {
  return new Store({
    ...initialState,
    schedules: { items: schedules },
    worktrees: { ...initialState.worktrees, list: worktrees }
  })
}

describe('ScheduleRunner', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('fires a due one-time schedule and disables it', () => {
    const store = storeWith([mk()])
    const fire = vi.fn()
    const runner = new ScheduleRunner(store, { fire })
    runner.start()
    expect(fire).toHaveBeenCalledTimes(1)
    expect(fire.mock.calls[0][0].id).toBe('a')
    expect(store.getSnapshot().state.schedules.items[0].enabled).toBe(false)
    runner.stop()
  })

  it('fires a due repeating schedule and advances its time', () => {
    const store = storeWith([mk({ repeat: 'daily' })])
    const fire = vi.fn()
    const runner = new ScheduleRunner(store, { fire })
    runner.start()
    expect(fire).toHaveBeenCalledTimes(1)
    const after = store.getSnapshot().state.schedules.items[0]
    expect(after.enabled).toBe(true)
    expect(Date.parse(after.at)).toBeGreaterThan(NOW)
    runner.stop()
  })

  it('does not fire a future or disabled schedule', () => {
    const store = storeWith([
      mk({ id: 'future', at: '2026-07-02T09:00:00.000Z' }),
      mk({ id: 'off', enabled: false })
    ])
    const fire = vi.fn()
    const runner = new ScheduleRunner(store, { fire })
    runner.start()
    expect(fire).not.toHaveBeenCalled()
    runner.stop()
  })

  it('does not double-fire on a re-scan', () => {
    const store = storeWith([mk()])
    const fire = vi.fn()
    const runner = new ScheduleRunner(store, { fire })
    runner.start()
    runner.scan()
    expect(fire).toHaveBeenCalledTimes(1)
    runner.stop()
  })

  it('prunes worktree-scoped schedules whose worktree is gone', () => {
    const store = storeWith([
      mk({
        id: 'wt',
        at: '2026-07-09T09:00:00.000Z', // future, so it won't fire
        target: { kind: 'worktree', worktreePath: '/wt/gone', repoRoot: '/repo' }
      })
    ])
    const fire = vi.fn()
    const runner = new ScheduleRunner(store, { fire })
    runner.start()
    expect(store.getSnapshot().state.schedules.items).toHaveLength(0)
    runner.stop()
  })

  it('keeps a worktree-scoped schedule that already ran even if its worktree is gone', () => {
    const store = storeWith([
      mk({
        id: 'wt',
        at: '2026-07-09T09:00:00.000Z',
        lastRunAt: '2026-06-30T09:00:00.000Z',
        target: { kind: 'worktree', worktreePath: '/wt/gone', repoRoot: '/repo' }
      })
    ])
    const fire = vi.fn()
    const runner = new ScheduleRunner(store, { fire })
    runner.start()
    expect(store.getSnapshot().state.schedules.items).toHaveLength(1)
    runner.stop()
  })

  it('keeps worktree-scoped schedules whose worktree still exists', () => {
    const store = storeWith(
      [
        mk({
          id: 'wt',
          at: '2026-07-09T09:00:00.000Z',
          target: { kind: 'worktree', worktreePath: '/wt/live', repoRoot: '/repo' }
        })
      ],
      [{ path: '/wt/live', branch: 'feature', repoRoot: '/repo' } as Worktree]
    )
    const fire = vi.fn()
    const runner = new ScheduleRunner(store, { fire })
    runner.start()
    expect(store.getSnapshot().state.schedules.items).toHaveLength(1)
    runner.stop()
  })

  it('fires on the wake timer when a schedule comes due', () => {
    const store = storeWith([mk({ at: '2026-07-01T12:00:30.000Z' })]) // 30s out
    const fire = vi.fn()
    const runner = new ScheduleRunner(store, { fire })
    runner.start()
    expect(fire).not.toHaveBeenCalled()
    vi.advanceTimersByTime(31_000)
    expect(fire).toHaveBeenCalledTimes(1)
    runner.stop()
  })
})
