import type { SessionUsage } from '../../shared/state/costs'
import { getLeaves, type PaneNode } from '../../shared/state/terminals'

/** Strip Claude's repetitive prefix and date suffix.
 *  e.g. claude-opus-4-7-20251022 -> opus-4-7 */
export function shortModel(model: string): string {
  return model.replace(/^claude-/, '').replace(/-\d{8}$/, '')
}

/** Compact age label for the sidebar. Years switch in at >=365 days so a
 *  long-lived worktree doesn't read as a giant day count. `now` is a
 *  parameter so tests don't have to mock Date. */
export function formatWorktreeAge(createdAt: number, now: number = Date.now()): string {
  if (!createdAt) return '—'
  const ms = now - createdAt
  if (ms < 0) return '—'
  const hours = ms / (1000 * 60 * 60)
  if (hours < 1) return '<1h'
  const days = hours / 24
  if (days < 1) return `${Math.floor(hours)}h`
  if (days < 365) return `${Math.floor(days)}d`
  return `${(days / 365).toFixed(1)}y`
}

/** Walks the worktree's pane tree, looks up cost data for each agent /
 *  json-claude tab, and returns the most recently updated `currentModel`.
 *  Returns '' if no tab has produced an assistant message yet. */
export function pickLatestWorktreeModel(
  tree: PaneNode | undefined,
  byTerminal: Record<string, SessionUsage>
): string {
  if (!tree) return ''
  let latestModel = ''
  let latestTs = -Infinity
  for (const leaf of getLeaves(tree)) {
    for (const tab of leaf.tabs) {
      if (tab.type !== 'agent' && tab.type !== 'json-claude') continue
      const usage = byTerminal[tab.id]
      if (!usage || !usage.currentModel) continue
      if (usage.updatedAt > latestTs) {
        latestTs = usage.updatedAt
        latestModel = usage.currentModel
      }
    }
  }
  return latestModel
}
