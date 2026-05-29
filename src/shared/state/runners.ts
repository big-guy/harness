// Registered "runners" — named shell commands an agent registers (via the
// register_runner MCP tool) for a human manager/overseer to launch from the
// Toolbox dropdown in the tab toolbar. Each runner is { name, description,
// command }; clicking one opens a new shell tab running the command.
//
// Runners are scoped per worktree: an agent registers runners for the
// worktree it's running in, and the Toolbox dropdown only shows that
// worktree's runners. Two worktrees can carry different sets. Each
// worktree's list is kept sorted by name so the dropdown renders in
// alphabetical order without the UI re-sorting. Registration is an upsert
// keyed on name (case-insensitive) so re-registering with a tweaked
// command/description updates the existing entry instead of duplicating.

export interface RunnerItem {
  /** Short, unique display name. Used as the dropdown label and the
   *  upsert key (case-insensitive). */
  name: string
  /** Human-readable explanation shown as the dropdown item's tooltip. */
  description: string
  /** Shell command run via `zsh -ilc <command>` in a new shell tab. */
  command: string
  /** Optional Lucide icon name (e.g. "Play", "FlaskConical") shown next to
   *  the name in the dropdown. Stored as provided; the renderer resolves it
   *  against the Lucide registry and silently shows no icon if it's not a
   *  valid icon name. */
  icon?: string
  /** Optional max number of concurrent instances of this runner per worktree.
   *  Undefined = unlimited (every launch spawns a new shell tab). When set,
   *  launches stop spawning once the cap is reached (and focus an existing
   *  instance instead). cardinality === 1 is the single-instance case that
   *  also gets a restart button in the dropdown. */
  cardinality?: number
}

export interface RunnersState {
  /** Registered runners keyed by worktree path; each list sorted by name. */
  byWorktree: Record<string, RunnerItem[]>
}

export type RunnersEvent =
  | { type: 'runners/loaded'; payload: Record<string, RunnerItem[]> }
  | { type: 'runners/registered'; payload: { worktreePath: string; item: RunnerItem } }
  | { type: 'runners/removed'; payload: { worktreePath: string; name: string } }

export const initialRunners: RunnersState = {
  byWorktree: {}
}

function sortByName(items: RunnerItem[]): RunnerItem[] {
  return [...items].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
  )
}

export function runnersReducer(
  state: RunnersState,
  event: RunnersEvent
): RunnersState {
  switch (event.type) {
    case 'runners/loaded': {
      const byWorktree: Record<string, RunnerItem[]> = {}
      for (const [wt, items] of Object.entries(event.payload)) {
        byWorktree[wt] = sortByName(items)
      }
      return { byWorktree }
    }
    case 'runners/registered': {
      const { worktreePath, item } = event.payload
      const current = state.byWorktree[worktreePath] ?? []
      const i = current.findIndex(
        (r) => r.name.toLowerCase() === item.name.toLowerCase()
      )
      const next =
        i === -1
          ? [...current, item]
          : [...current.slice(0, i), item, ...current.slice(i + 1)]
      return {
        byWorktree: { ...state.byWorktree, [worktreePath]: sortByName(next) }
      }
    }
    case 'runners/removed': {
      const { worktreePath, name } = event.payload
      const current = state.byWorktree[worktreePath]
      if (!current) return state
      const i = current.findIndex((r) => r.name.toLowerCase() === name.toLowerCase())
      if (i === -1) return state
      const next = [...current.slice(0, i), ...current.slice(i + 1)]
      const byWorktree = { ...state.byWorktree }
      if (next.length === 0) {
        delete byWorktree[worktreePath]
      } else {
        byWorktree[worktreePath] = next
      }
      return { byWorktree }
    }
    default: {
      const _exhaustive: never = event
      void _exhaustive
      return state
    }
  }
}
