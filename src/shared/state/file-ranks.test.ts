import { describe, it, expect } from 'vitest'
import {
  initialFileRanks,
  fileRanksReducer,
  type FileRankEntry
} from './file-ranks'

const WT = '/w'
const F = 'src/a.ts'

describe('fileRanksReducer', () => {
  it('fileRanks/userRankSet upserts a user-sourced entry', () => {
    const next = fileRanksReducer(initialFileRanks, {
      type: 'fileRanks/userRankSet',
      payload: { worktreePath: WT, filePath: F, rank: 'important' }
    })
    expect(next.byWorktree[WT].entries[F]).toEqual<FileRankEntry>({
      rank: 'important',
      source: 'user'
    })
  })

  it('fileRanks/userRankSet overrides an existing agent entry', () => {
    const s1 = fileRanksReducer(initialFileRanks, {
      type: 'fileRanks/agentRankSet',
      payload: { worktreePath: WT, filePath: F, rank: 'trivial' }
    })
    const s2 = fileRanksReducer(s1, {
      type: 'fileRanks/userRankSet',
      payload: { worktreePath: WT, filePath: F, rank: 'important' }
    })
    expect(s2.byWorktree[WT].entries[F]).toEqual<FileRankEntry>({
      rank: 'important',
      source: 'user'
    })
  })

  it('fileRanks/userRankCleared removes the entry entirely', () => {
    const s1 = fileRanksReducer(initialFileRanks, {
      type: 'fileRanks/userRankSet',
      payload: { worktreePath: WT, filePath: F, rank: 'normal' }
    })
    const s2 = fileRanksReducer(s1, {
      type: 'fileRanks/userRankCleared',
      payload: { worktreePath: WT, filePath: F }
    })
    expect(s2.byWorktree[WT].entries[F]).toBeUndefined()
  })

  it('fileRanks/userRankCleared is a no-op when the entry is missing', () => {
    const next = fileRanksReducer(initialFileRanks, {
      type: 'fileRanks/userRankCleared',
      payload: { worktreePath: WT, filePath: F }
    })
    expect(next).toBe(initialFileRanks)
  })

  it('fileRanks/agentRankSet writes an agent-sourced entry when none exists', () => {
    const next = fileRanksReducer(initialFileRanks, {
      type: 'fileRanks/agentRankSet',
      payload: { worktreePath: WT, filePath: F, rank: 'important' }
    })
    expect(next.byWorktree[WT].entries[F]).toEqual<FileRankEntry>({
      rank: 'important',
      source: 'agent'
    })
  })

  it('fileRanks/agentRankSet no-ops when a user-sourced entry exists', () => {
    const s1 = fileRanksReducer(initialFileRanks, {
      type: 'fileRanks/userRankSet',
      payload: { worktreePath: WT, filePath: F, rank: 'normal' }
    })
    const s2 = fileRanksReducer(s1, {
      type: 'fileRanks/agentRankSet',
      payload: { worktreePath: WT, filePath: F, rank: 'trivial' }
    })
    expect(s2).toBe(s1)
    expect(s2.byWorktree[WT].entries[F]).toEqual<FileRankEntry>({
      rank: 'normal',
      source: 'user'
    })
  })

  it('fileRanks/agentRankSet overrides another agent entry', () => {
    const s1 = fileRanksReducer(initialFileRanks, {
      type: 'fileRanks/agentRankSet',
      payload: { worktreePath: WT, filePath: F, rank: 'normal' }
    })
    const s2 = fileRanksReducer(s1, {
      type: 'fileRanks/agentRankSet',
      payload: { worktreePath: WT, filePath: F, rank: 'important' }
    })
    expect(s2.byWorktree[WT].entries[F]).toEqual<FileRankEntry>({
      rank: 'important',
      source: 'agent'
    })
  })

  it('fileRanks/agentRanksCleared removes only agent entries', () => {
    let state = fileRanksReducer(initialFileRanks, {
      type: 'fileRanks/userRankSet',
      payload: { worktreePath: WT, filePath: 'user.ts', rank: 'important' }
    })
    state = fileRanksReducer(state, {
      type: 'fileRanks/agentRankSet',
      payload: { worktreePath: WT, filePath: 'agent.ts', rank: 'trivial' }
    })
    const cleared = fileRanksReducer(state, {
      type: 'fileRanks/agentRanksCleared',
      payload: { worktreePath: WT, filePaths: ['user.ts', 'agent.ts', 'missing.ts'] }
    })
    expect(cleared.byWorktree[WT].entries['user.ts']).toEqual({
      rank: 'important',
      source: 'user'
    })
    expect(cleared.byWorktree[WT].entries['agent.ts']).toBeUndefined()
  })

  it('fileRanks/agentRanksCleared is a no-op when nothing matches', () => {
    const s1 = fileRanksReducer(initialFileRanks, {
      type: 'fileRanks/userRankSet',
      payload: { worktreePath: WT, filePath: F, rank: 'important' }
    })
    const s2 = fileRanksReducer(s1, {
      type: 'fileRanks/agentRanksCleared',
      payload: { worktreePath: WT, filePaths: [F] }
    })
    expect(s2).toBe(s1)
  })

  it('fileRanks/lastSeenShaUpdated stores the sha', () => {
    const next = fileRanksReducer(initialFileRanks, {
      type: 'fileRanks/lastSeenShaUpdated',
      payload: { worktreePath: WT, sha: 'abc123' }
    })
    expect(next.byWorktree[WT].lastSeenSha).toBe('abc123')
  })

  it('fileRanks/lastSeenShaUpdated is a no-op when the sha is unchanged', () => {
    const s1 = fileRanksReducer(initialFileRanks, {
      type: 'fileRanks/lastSeenShaUpdated',
      payload: { worktreePath: WT, sha: 'abc123' }
    })
    const s2 = fileRanksReducer(s1, {
      type: 'fileRanks/lastSeenShaUpdated',
      payload: { worktreePath: WT, sha: 'abc123' }
    })
    expect(s2).toBe(s1)
  })

  it('fileRanks/worktreeRemoved drops the worktree entry', () => {
    const s1 = fileRanksReducer(initialFileRanks, {
      type: 'fileRanks/userRankSet',
      payload: { worktreePath: WT, filePath: F, rank: 'important' }
    })
    const s2 = fileRanksReducer(s1, {
      type: 'fileRanks/worktreeRemoved',
      payload: { worktreePath: WT }
    })
    expect(s2.byWorktree[WT]).toBeUndefined()
  })

  it('fileRanks/worktreeRemoved is a no-op for an unknown path', () => {
    const next = fileRanksReducer(initialFileRanks, {
      type: 'fileRanks/worktreeRemoved',
      payload: { worktreePath: '/nope' }
    })
    expect(next).toBe(initialFileRanks)
  })

  it('does not mutate input state on writes', () => {
    const next = fileRanksReducer(initialFileRanks, {
      type: 'fileRanks/userRankSet',
      payload: { worktreePath: WT, filePath: F, rank: 'important' }
    })
    expect(next).not.toBe(initialFileRanks)
    expect(initialFileRanks.byWorktree).toEqual({})
  })
})
