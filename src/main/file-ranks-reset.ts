import type { Store } from './store'

export type FileRanksResetMode = 'working' | 'branch' | 'commit'

export interface ResetDeps {
  store: Store
  revParseHead: (worktreePath: string) => Promise<string | null>
  diffNames: (
    worktreePath: string,
    fromSha: string,
    toSha: string
  ) => Promise<string[]>
}

/** Lazy reset-on-commit check. Runs inside the worktree:changedFiles
 *  handler. For working/branch modes only — historical commit views never
 *  reset. Side-effects (dispatches) are scoped to the supplied store.
 *
 *  Behavior:
 *  - no recorded sha → record current HEAD, no clearing (first sighting)
 *  - HEAD unchanged   → no-op
 *  - HEAD moved       → clear agent ranks for files in the diff, then
 *                       record the new HEAD
 *
 *  HEAD lookup or diff failures fall through silently — better to render
 *  stale ranks than to fail the changed-files render. */
export async function applyFileRanksReset(
  worktreePath: string,
  mode: FileRanksResetMode,
  deps: ResetDeps
): Promise<void> {
  if (mode === 'commit') return
  if (!worktreePath) return

  const head = await deps.revParseHead(worktreePath).catch(() => null)
  if (!head) return

  const wt = deps.store.getSnapshot().state.fileRanks.byWorktree[worktreePath]
  const lastSeenSha = wt?.lastSeenSha ?? null

  if (lastSeenSha === null) {
    deps.store.dispatch({
      type: 'fileRanks/lastSeenShaUpdated',
      payload: { worktreePath, sha: head }
    })
    return
  }

  if (lastSeenSha === head) return

  const changed = await deps.diffNames(worktreePath, lastSeenSha, head).catch(() => null)
  if (changed === null) return

  if (changed.length > 0) {
    deps.store.dispatch({
      type: 'fileRanks/agentRanksCleared',
      payload: { worktreePath, filePaths: changed }
    })
  }
  deps.store.dispatch({
    type: 'fileRanks/lastSeenShaUpdated',
    payload: { worktreePath, sha: head }
  })
}
