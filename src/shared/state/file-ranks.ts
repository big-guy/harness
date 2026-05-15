export type Rank = 'important' | 'normal' | 'trivial' | 'uninteresting'
export type RankSource = 'user' | 'agent'

export interface FileRankEntry {
  rank: Rank
  source: RankSource
}

export interface WorktreeFileRanks {
  entries: Record<string, FileRankEntry>
  lastSeenSha: string | null
}

export interface FileRanksState {
  byWorktree: Record<string, WorktreeFileRanks>
}

export type FileRanksEvent =
  | {
      type: 'fileRanks/userRankSet'
      payload: { worktreePath: string; filePath: string; rank: Rank }
    }
  | {
      type: 'fileRanks/userRankCleared'
      payload: { worktreePath: string; filePath: string }
    }
  | {
      type: 'fileRanks/agentRankSet'
      payload: { worktreePath: string; filePath: string; rank: Rank }
    }
  | {
      type: 'fileRanks/agentRanksCleared'
      payload: { worktreePath: string; filePaths: string[] }
    }
  | {
      type: 'fileRanks/lastSeenShaUpdated'
      payload: { worktreePath: string; sha: string }
    }
  | {
      type: 'fileRanks/worktreeRemoved'
      payload: { worktreePath: string }
    }

export const initialFileRanks: FileRanksState = {
  byWorktree: {}
}

const emptyWorktree: WorktreeFileRanks = { entries: {}, lastSeenSha: null }

function getWorktree(state: FileRanksState, path: string): WorktreeFileRanks {
  return state.byWorktree[path] ?? emptyWorktree
}

export function fileRanksReducer(
  state: FileRanksState,
  event: FileRanksEvent
): FileRanksState {
  switch (event.type) {
    case 'fileRanks/userRankSet': {
      const { worktreePath, filePath, rank } = event.payload
      const wt = getWorktree(state, worktreePath)
      const next: WorktreeFileRanks = {
        ...wt,
        entries: { ...wt.entries, [filePath]: { rank, source: 'user' } }
      }
      return {
        ...state,
        byWorktree: { ...state.byWorktree, [worktreePath]: next }
      }
    }
    case 'fileRanks/userRankCleared': {
      const { worktreePath, filePath } = event.payload
      const wt = state.byWorktree[worktreePath]
      if (!wt || !(filePath in wt.entries)) return state
      const entries = { ...wt.entries }
      delete entries[filePath]
      return {
        ...state,
        byWorktree: {
          ...state.byWorktree,
          [worktreePath]: { ...wt, entries }
        }
      }
    }
    case 'fileRanks/agentRankSet': {
      const { worktreePath, filePath, rank } = event.payload
      const wt = getWorktree(state, worktreePath)
      const existing = wt.entries[filePath]
      if (existing && existing.source === 'user') return state
      const next: WorktreeFileRanks = {
        ...wt,
        entries: { ...wt.entries, [filePath]: { rank, source: 'agent' } }
      }
      return {
        ...state,
        byWorktree: { ...state.byWorktree, [worktreePath]: next }
      }
    }
    case 'fileRanks/agentRanksCleared': {
      const { worktreePath, filePaths } = event.payload
      const wt = state.byWorktree[worktreePath]
      if (!wt) return state
      let entries = wt.entries
      let mutated = false
      for (const p of filePaths) {
        const e = entries[p]
        if (e && e.source === 'agent') {
          if (!mutated) {
            entries = { ...entries }
            mutated = true
          }
          delete entries[p]
        }
      }
      if (!mutated) return state
      return {
        ...state,
        byWorktree: {
          ...state.byWorktree,
          [worktreePath]: { ...wt, entries }
        }
      }
    }
    case 'fileRanks/lastSeenShaUpdated': {
      const { worktreePath, sha } = event.payload
      const wt = getWorktree(state, worktreePath)
      if (wt.lastSeenSha === sha) return state
      return {
        ...state,
        byWorktree: {
          ...state.byWorktree,
          [worktreePath]: { ...wt, lastSeenSha: sha }
        }
      }
    }
    case 'fileRanks/worktreeRemoved': {
      const { worktreePath } = event.payload
      if (!(worktreePath in state.byWorktree)) return state
      const next = { ...state.byWorktree }
      delete next[worktreePath]
      return { ...state, byWorktree: next }
    }
    default: {
      const _exhaustive: never = event
      void _exhaustive
      return state
    }
  }
}
