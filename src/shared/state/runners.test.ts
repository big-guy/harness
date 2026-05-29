import { describe, it, expect } from 'vitest'
import { initialRunners, runnersReducer, type RunnerItem } from './runners'

const r = (name: string, command = `cmd ${name}`, description = `desc ${name}`): RunnerItem => ({
  name,
  description,
  command
})

const WT_A = '/wt/a'
const WT_B = '/wt/b'

describe('runnersReducer', () => {
  it('loaded replaces the map and sorts each worktree list by name', () => {
    const next = runnersReducer(initialRunners, {
      type: 'runners/loaded',
      payload: { [WT_A]: [r('zebra'), r('apple')], [WT_B]: [r('mango')] }
    })
    expect(next.byWorktree[WT_A].map((i) => i.name)).toEqual(['apple', 'zebra'])
    expect(next.byWorktree[WT_B].map((i) => i.name)).toEqual(['mango'])
  })

  it('registered scopes to a worktree and keeps it sorted', () => {
    const s1 = runnersReducer(initialRunners, {
      type: 'runners/registered',
      payload: { worktreePath: WT_A, item: r('build') }
    })
    const s2 = runnersReducer(s1, {
      type: 'runners/registered',
      payload: { worktreePath: WT_A, item: r('apptest') }
    })
    expect(s2.byWorktree[WT_A].map((i) => i.name)).toEqual(['apptest', 'build'])
  })

  it('keeps two worktrees independent', () => {
    const s1 = runnersReducer(initialRunners, {
      type: 'runners/registered',
      payload: { worktreePath: WT_A, item: r('dev') }
    })
    const s2 = runnersReducer(s1, {
      type: 'runners/registered',
      payload: { worktreePath: WT_B, item: r('test') }
    })
    expect(s2.byWorktree[WT_A].map((i) => i.name)).toEqual(['dev'])
    expect(s2.byWorktree[WT_B].map((i) => i.name)).toEqual(['test'])
    // registering in B leaves A's array reference untouched
    expect(s2.byWorktree[WT_A]).toBe(s1.byWorktree[WT_A])
  })

  it('registered upserts by name (case-insensitive) within a worktree', () => {
    const s1 = runnersReducer(initialRunners, {
      type: 'runners/registered',
      payload: { worktreePath: WT_A, item: r('Dev', 'npm run dev', 'start') }
    })
    const s2 = runnersReducer(s1, {
      type: 'runners/registered',
      payload: { worktreePath: WT_A, item: r('dev', 'npm run dev -- --host', 'start exposed') }
    })
    expect(s2.byWorktree[WT_A]).toHaveLength(1)
    expect(s2.byWorktree[WT_A][0].command).toBe('npm run dev -- --host')
    expect(s2.byWorktree[WT_A][0].description).toBe('start exposed')
  })

  it('removed drops a runner (case-insensitive) and prunes empty worktrees', () => {
    const s1 = runnersReducer(initialRunners, {
      type: 'runners/loaded',
      payload: { [WT_A]: [r('build'), r('test')] }
    })
    const s2 = runnersReducer(s1, {
      type: 'runners/removed',
      payload: { worktreePath: WT_A, name: 'BUILD' }
    })
    expect(s2.byWorktree[WT_A].map((i) => i.name)).toEqual(['test'])
    const s3 = runnersReducer(s2, {
      type: 'runners/removed',
      payload: { worktreePath: WT_A, name: 'test' }
    })
    expect(s3.byWorktree[WT_A]).toBeUndefined()
  })

  it('removed for an unknown worktree/name is a no-op (same reference)', () => {
    const s1 = runnersReducer(initialRunners, {
      type: 'runners/registered',
      payload: { worktreePath: WT_A, item: r('build') }
    })
    const s2 = runnersReducer(s1, {
      type: 'runners/removed',
      payload: { worktreePath: WT_B, name: 'build' }
    })
    expect(s2).toBe(s1)
  })
})
