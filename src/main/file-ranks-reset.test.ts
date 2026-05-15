import { describe, it, expect } from 'vitest'
import { Store } from './store'
import { applyFileRanksReset } from './file-ranks-reset'
import type { Rank } from '../shared/state/file-ranks'

const WT = '/w'

function makeDeps(opts: {
  head: string | null
  diff?: string[]
  diffShouldThrow?: boolean
}) {
  const store = new Store()
  const calls = { revParse: 0, diff: 0 }
  const deps = {
    store,
    async revParseHead(_path: string) {
      calls.revParse++
      return opts.head
    },
    async diffNames(_path: string, _from: string, _to: string) {
      calls.diff++
      if (opts.diffShouldThrow) throw new Error('boom')
      return opts.diff ?? []
    }
  }
  return { store, deps, calls }
}

function seedUserRank(store: Store, path: string, file: string, rank: Rank): void {
  store.dispatch({
    type: 'fileRanks/userRankSet',
    payload: { worktreePath: path, filePath: file, rank }
  })
}

function seedAgentRank(store: Store, path: string, file: string, rank: Rank): void {
  store.dispatch({
    type: 'fileRanks/agentRankSet',
    payload: { worktreePath: path, filePath: file, rank }
  })
}

describe('applyFileRanksReset', () => {
  it('first sighting records HEAD without clearing', async () => {
    const { store, deps } = makeDeps({ head: 'sha-A' })
    seedAgentRank(store, WT, 'a.ts', 'important')

    await applyFileRanksReset(WT, 'working', deps)

    const wt = store.getSnapshot().state.fileRanks.byWorktree[WT]
    expect(wt.lastSeenSha).toBe('sha-A')
    expect(wt.entries['a.ts']).toEqual({ rank: 'important', source: 'agent' })
  })

  it('unchanged HEAD is a no-op', async () => {
    const { store, deps } = makeDeps({ head: 'sha-A' })
    seedAgentRank(store, WT, 'a.ts', 'important')
    await applyFileRanksReset(WT, 'working', deps)
    const seq1 = store.getSnapshot().seq

    await applyFileRanksReset(WT, 'working', deps)
    expect(store.getSnapshot().seq).toBe(seq1)
  })

  it('new HEAD clears agent ranks for changed files only', async () => {
    const { store, deps: depsInit } = makeDeps({ head: 'sha-A' })
    seedAgentRank(store, WT, 'changed.ts', 'important')
    seedAgentRank(store, WT, 'untouched.ts', 'trivial')
    seedUserRank(store, WT, 'user.ts', 'important')
    await applyFileRanksReset(WT, 'working', depsInit)

    const deps2 = {
      ...depsInit,
      revParseHead: async () => 'sha-B',
      diffNames: async () => ['changed.ts', 'user.ts']
    }
    await applyFileRanksReset(WT, 'working', deps2)

    const wt = store.getSnapshot().state.fileRanks.byWorktree[WT]
    expect(wt.lastSeenSha).toBe('sha-B')
    expect(wt.entries['changed.ts']).toBeUndefined()
    expect(wt.entries['untouched.ts']).toEqual({ rank: 'trivial', source: 'agent' })
    expect(wt.entries['user.ts']).toEqual({ rank: 'important', source: 'user' })
  })

  it('mode=commit never triggers reset', async () => {
    const { store, deps } = makeDeps({ head: 'sha-A' })
    seedAgentRank(store, WT, 'a.ts', 'important')

    await applyFileRanksReset(WT, 'commit', deps)
    const wt = store.getSnapshot().state.fileRanks.byWorktree[WT]
    expect(wt.lastSeenSha).toBeNull()
    expect(wt.entries['a.ts']).toEqual({ rank: 'important', source: 'agent' })
  })

  it('mode=branch behaves like working', async () => {
    const { store, deps } = makeDeps({ head: 'sha-A' })
    await applyFileRanksReset(WT, 'branch', deps)
    expect(store.getSnapshot().state.fileRanks.byWorktree[WT].lastSeenSha).toBe('sha-A')
  })

  it('rev-parse failure leaves state untouched', async () => {
    const { store, deps } = makeDeps({ head: null })
    seedAgentRank(store, WT, 'a.ts', 'important')
    const before = store.getSnapshot().seq

    await applyFileRanksReset(WT, 'working', deps)
    expect(store.getSnapshot().seq).toBe(before)
  })

  it('diff failure does not update lastSeenSha (will retry next call)', async () => {
    const { store, deps: depsInit } = makeDeps({ head: 'sha-A' })
    await applyFileRanksReset(WT, 'working', depsInit)
    const deps2 = {
      ...depsInit,
      revParseHead: async () => 'sha-B',
      diffShouldThrow: true,
      diffNames: async () => {
        throw new Error('boom')
      }
    }
    await applyFileRanksReset(WT, 'working', deps2)
    expect(store.getSnapshot().state.fileRanks.byWorktree[WT].lastSeenSha).toBe('sha-A')
  })

  it('empty filePath list still updates lastSeenSha', async () => {
    const { store, deps: depsInit } = makeDeps({ head: 'sha-A' })
    await applyFileRanksReset(WT, 'working', depsInit)
    const deps2 = {
      ...depsInit,
      revParseHead: async () => 'sha-B',
      diffNames: async () => []
    }
    await applyFileRanksReset(WT, 'working', deps2)
    expect(store.getSnapshot().state.fileRanks.byWorktree[WT].lastSeenSha).toBe('sha-B')
  })
})
