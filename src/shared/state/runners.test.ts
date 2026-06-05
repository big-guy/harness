import { describe, it, expect } from 'vitest'
import {
  initialRunners,
  runnersReducer,
  sanitizeRunnerList,
  type RunnerItem
} from './runners'

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

describe('sanitizeRunnerList', () => {
  it('returns [] for non-array input', () => {
    expect(sanitizeRunnerList(undefined)).toEqual([])
    expect(sanitizeRunnerList(null)).toEqual([])
    expect(sanitizeRunnerList({})).toEqual([])
    expect(sanitizeRunnerList('nope')).toEqual([])
  })

  it('drops entries missing a name or command, trims, coerces description', () => {
    const out = sanitizeRunnerList([
      { name: '  build  ', command: '  npm run build  ' },
      { name: 'no-command' },
      { command: 'no-name' },
      { name: 'bad', command: '   ' },
      null,
      'string'
    ])
    expect(out).toEqual([{ name: 'build', command: 'npm run build', description: '' }])
  })

  it('keeps a valid icon + integer cardinality >= 1, drops invalid ones', () => {
    const out = sanitizeRunnerList([
      { name: 'a', command: 'cmd', icon: ' Play ', cardinality: 1 },
      { name: 'b', command: 'cmd', icon: '  ', cardinality: 0 },
      { name: 'c', command: 'cmd', cardinality: 2.5 },
      { name: 'd', command: 'cmd', cardinality: -3 }
    ])
    expect(out).toEqual([
      { name: 'a', command: 'cmd', description: '', icon: 'Play', cardinality: 1 },
      { name: 'b', command: 'cmd', description: '' },
      { name: 'c', command: 'cmd', description: '' },
      { name: 'd', command: 'cmd', description: '' }
    ])
  })

  it('dedups case-insensitively by name, first occurrence wins', () => {
    const out = sanitizeRunnerList([
      { name: 'Dev', command: 'first' },
      { name: 'dev', command: 'second' }
    ])
    expect(out).toEqual([{ name: 'Dev', command: 'first', description: '' }])
  })

  it('preserves input order (no sorting)', () => {
    const out = sanitizeRunnerList([
      { name: 'zebra', command: 'z' },
      { name: 'apple', command: 'a' }
    ]) as RunnerItem[]
    expect(out.map((i) => i.name)).toEqual(['zebra', 'apple'])
  })
})
