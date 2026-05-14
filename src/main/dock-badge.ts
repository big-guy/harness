import { app } from 'electron'
import type { Store } from './store'
import type { AppState, StateEvent } from '../shared/state'
import type { PtyStatus, PaneNode } from '../shared/state/terminals'
import { getLeaves } from '../shared/state/terminals'

const STATUS_RANK: Record<PtyStatus, number> = {
  idle: 0,
  processing: 1,
  waiting: 2,
  'needs-approval': 3
}

function aggregateWorktreeStatus(
  tree: PaneNode | undefined,
  statuses: Record<string, PtyStatus>
): PtyStatus {
  if (!tree) return 'idle'
  let worst: PtyStatus = 'idle'
  for (const leaf of getLeaves(tree)) {
    for (const tab of leaf.tabs) {
      if (tab.type !== 'agent' && tab.type !== 'shell' && tab.type !== 'json-claude') continue
      const s = statuses[tab.id]
      if (!s) continue
      if (STATUS_RANK[s] > STATUS_RANK[worst]) worst = s
    }
  }
  return worst
}

/** Pure derivation used by both the live subscriber and the unit test. */
export function countWorktreesNeedingApproval(
  worktreePaths: string[],
  panes: Record<string, PaneNode>,
  statuses: Record<string, PtyStatus>
): number {
  let count = 0
  for (const path of worktreePaths) {
    if (aggregateWorktreeStatus(panes[path], statuses) === 'needs-approval') {
      count++
    }
  }
  return count
}

function deriveCount(state: AppState): number {
  if (!state.settings.dockBadgeEnabled) return 0
  return countWorktreesNeedingApproval(
    state.worktrees.list.map((w) => w.path),
    state.terminals.panes,
    state.terminals.statuses
  )
}

/** Subscribes to the store and mirrors the count of `needs-approval`
 *  worktrees onto the macOS dock badge. No-op on non-Darwin or when
 *  `app.dock` is unavailable (e.g. headless / test). */
export class DockBadge {
  private store: Store
  private unsubscribe: (() => void) | null = null
  private lastCount = -1

  constructor(store: Store) {
    this.store = store
  }

  start(): void {
    if (this.unsubscribe) return
    this.unsubscribe = this.store.subscribe((event) => this.onEvent(event))
    this.recompute()
  }

  stop(): void {
    if (this.unsubscribe) {
      this.unsubscribe()
      this.unsubscribe = null
    }
  }

  private onEvent(event: StateEvent): void {
    if (
      event.type === 'terminals/statusChanged' ||
      event.type === 'terminals/removed' ||
      event.type === 'terminals/panesReplaced' ||
      event.type === 'terminals/panesForWorktreeChanged' ||
      event.type === 'terminals/panesForWorktreeCleared' ||
      event.type === 'worktrees/listChanged' ||
      event.type === 'settings/dockBadgeEnabledChanged'
    ) {
      this.recompute()
    }
  }

  private recompute(): void {
    const state = this.store.getSnapshot().state
    const next = deriveCount(state)
    if (next === this.lastCount) return
    this.lastCount = next
    if (process.platform === 'darwin') {
      app.setBadgeCount(next)
    }
  }
}
