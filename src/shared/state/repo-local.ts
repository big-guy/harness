// Per-user-per-repo settings. Mirrors `repoConfigs` slice in shape, but
// the source of truth is `userData/config.json` (under the
// `perRepoLocal` key) instead of an in-repo `.harness.json`. Use this
// for values that are tied to the local machine / user and must NOT be
// committed across collaborators — claude_config_dir paths, personal
// account badges, etc.
//
// Backend behavior: this lives on the backend's machine (the
// `userData` of whichever process serves the data). When a client
// switches backends via the chip strip, the active backend's
// `perRepoLocal` is what the renderer sees — the local Mac backend
// and a remote `harness-server` are fully isolated.

export type BadgeColor = 'blue' | 'green' | 'orange' | 'purple' | 'red' | 'yellow'
export type BadgeShape = 'astroid' | 'cross' | 'pentagon' | 'square'

export interface ClaudeAccountBadge {
  color: BadgeColor
  shape: BadgeShape
}

export const BADGE_COLORS: BadgeColor[] = [
  'blue',
  'green',
  'orange',
  'purple',
  'red',
  'yellow'
]
export const BADGE_SHAPES: BadgeShape[] = ['astroid', 'cross', 'pentagon', 'square']

/** Default visual when the user enables `claudeConfigDir` but hasn't
 *  picked a badge yet — Settings seeds with this so something visible
 *  always appears in the toolbar / Cost header. */
export const DEFAULT_CLAUDE_ACCOUNT_BADGE: ClaudeAccountBadge = {
  color: 'blue',
  shape: 'pentagon'
}

export interface RepoLocalConfig {
  /** Per-repo override for Claude's home directory. When non-empty,
   *  Harness exports `CLAUDE_CONFIG_DIR=<this>` on every Claude spawn
   *  for worktrees in this repo. A leading `~` is expanded at spawn
   *  time. */
  claudeConfigDir?: string
  /** Color+shape used to mark this repo's Claude account in toolbars
   *  and panel headers. Only meaningful when `claudeConfigDir` is set
   *  (we don't badge the default `~/.claude` account). */
  claudeAccountBadge?: ClaudeAccountBadge
}

export interface RepoLocalState {
  /** Per-repo local config keyed by repoRoot. Hydrated at boot from
   *  `config.perRepoLocal` and replaced wholesale on each set. */
  byRepo: Record<string, RepoLocalConfig>
}

export type RepoLocalEvent =
  | { type: 'repoLocal/loaded'; payload: Record<string, RepoLocalConfig> }
  | { type: 'repoLocal/changed'; payload: { repoRoot: string; config: RepoLocalConfig } }
  | { type: 'repoLocal/removed'; payload: string }

export const initialRepoLocal: RepoLocalState = {
  byRepo: {}
}

export function repoLocalReducer(
  state: RepoLocalState,
  event: RepoLocalEvent
): RepoLocalState {
  switch (event.type) {
    case 'repoLocal/loaded':
      return { ...state, byRepo: event.payload }
    case 'repoLocal/changed':
      return {
        ...state,
        byRepo: { ...state.byRepo, [event.payload.repoRoot]: event.payload.config }
      }
    case 'repoLocal/removed': {
      if (!(event.payload in state.byRepo)) return state
      const { [event.payload]: _dropped, ...rest } = state.byRepo
      void _dropped
      return { ...state, byRepo: rest }
    }
    default: {
      const _exhaustive: never = event
      void _exhaustive
      return state
    }
  }
}
