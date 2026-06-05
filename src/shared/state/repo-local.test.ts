import { describe, it, expect } from 'vitest'
import {
  initialRepoLocal,
  repoLocalReducer,
  type RepoLocalConfig,
  type RepoLocalEvent,
  type RepoLocalState
} from './repo-local'

const apply = (s: RepoLocalState, e: RepoLocalEvent): RepoLocalState => repoLocalReducer(s, e)

describe('repoLocalReducer', () => {
  it('loaded replaces byRepo wholesale', () => {
    const seeded: Record<string, RepoLocalConfig> = {
      '/repo/a': { claudeConfigDir: '~/.claude-work' }
    }
    const next = apply(initialRepoLocal, { type: 'repoLocal/loaded', payload: seeded })
    expect(next.byRepo).toEqual(seeded)
  })

  it('changed upserts a single repo entry', () => {
    const start: RepoLocalState = { byRepo: { '/repo/a': {} } }
    const next = apply(start, {
      type: 'repoLocal/changed',
      payload: { repoRoot: '/repo/b', config: { claudeConfigDir: '~/.claude-personal' } }
    })
    expect(next.byRepo['/repo/a']).toEqual({})
    expect(next.byRepo['/repo/b']).toEqual({ claudeConfigDir: '~/.claude-personal' })
  })

  it('removed drops an entry and returns the same state if absent', () => {
    const start: RepoLocalState = { byRepo: { '/repo/a': { claudeConfigDir: '~/x' } } }
    const next = apply(start, { type: 'repoLocal/removed', payload: '/repo/a' })
    expect(next.byRepo).toEqual({})
    const again = apply(next, { type: 'repoLocal/removed', payload: '/repo/never' })
    expect(again).toBe(next)
  })
})
