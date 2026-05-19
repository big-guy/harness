// Inbox slice — holds the results of polled GitHub search-issues queries
// (PRs + issues). Items are keyed by query id so a configured query maps
// directly to a list; the InboxPoller in the main process writes here.
//
// This is intentionally separate from the `prs` slice. `prs.byPath` is
// keyed by worktree path and represents "the PR for this worktree";
// inbox items have no worktree (yet) and are keyed by (owner, repo,
// number). Conflating the two makes every existing PR consumer more
// complicated for no gain.

export type InboxKind = 'issue' | 'pr'

/** Lightweight reference used as a stable React key and to identify an item
 *  in IPC calls like `inbox:createWorktree`. */
export interface InboxItemRef {
  owner: string
  repo: string
  number: number
  kind: InboxKind
}

export interface InboxLabel {
  name: string
  /** Hex color without leading `#`, as returned by GitHub. */
  color: string
}

export interface InboxUser {
  login: string
  avatarUrl: string
}

export interface InboxMilestone {
  title: string
  state: 'open' | 'closed'
  number: number
}

export interface InboxItem {
  kind: InboxKind
  owner: string
  repo: string
  number: number
  title: string
  url: string
  /** Open/closed at the issue/PR level. PR-specific subtleties (draft,
   *  merged) are not modeled here — Inbox queries default to `is:open`
   *  so this is usually 'open'. */
  state: 'open' | 'closed'
  author: InboxUser | null
  labels: InboxLabel[]
  assignees: InboxUser[]
  createdAt: string
  updatedAt: string
  commentCount: number
  /** Short text body preview from the search result (issue body, truncated
   *  server-side). Null when the body wasn't returned. */
  bodyPreview: string | null
  /** Milestone the item belongs to, if any. */
  milestone: InboxMilestone | null
}

export interface InboxState {
  /** Items per configured query id. Bulk-replaced on each poll. */
  byQueryId: Record<string, InboxItem[]>
  /** True while a poll for a given query is in flight. */
  loading: Record<string, boolean>
  /** Total count reported by GitHub for the last poll of each query.
   *  When `> byQueryId[id].length` the UI shows a "narrow your query"
   *  truncation banner. */
  totalCount: Record<string, number>
  /** ms-since-epoch of the last successful fetch per query, used by the
   *  poller's "if-stale" refresh on focus. */
  lastFetchedAt: Record<string, number>
  /** Last error message per query, or null. Cleared on a successful poll. */
  errors: Record<string, string | null>
}

export type InboxEvent =
  | {
      type: 'inbox/queryLoadingChanged'
      payload: { queryId: string; loading: boolean }
    }
  | {
      type: 'inbox/queryResultChanged'
      payload: {
        queryId: string
        items: InboxItem[]
        totalCount: number
        fetchedAt: number
      }
    }
  | {
      type: 'inbox/queryErrorChanged'
      payload: { queryId: string; error: string | null }
    }
  /** Drop all per-query state for queries no longer in `inboxQueries`.
   *  Sent by main when the settings list changes so the renderer doesn't
   *  see stale data for a deleted query. */
  | { type: 'inbox/queriesPruned'; payload: { keepIds: string[] } }

export const initialInbox: InboxState = {
  byQueryId: {},
  loading: {},
  totalCount: {},
  lastFetchedAt: {},
  errors: {}
}

function pickKeys<V>(rec: Record<string, V>, keep: Set<string>): Record<string, V> {
  const next: Record<string, V> = {}
  for (const id of Object.keys(rec)) {
    if (keep.has(id)) next[id] = rec[id]
  }
  return next
}

export function inboxReducer(state: InboxState, event: InboxEvent): InboxState {
  switch (event.type) {
    case 'inbox/queryLoadingChanged':
      return {
        ...state,
        loading: { ...state.loading, [event.payload.queryId]: event.payload.loading }
      }
    case 'inbox/queryResultChanged': {
      const { queryId, items, totalCount, fetchedAt } = event.payload
      return {
        ...state,
        byQueryId: { ...state.byQueryId, [queryId]: items },
        totalCount: { ...state.totalCount, [queryId]: totalCount },
        lastFetchedAt: { ...state.lastFetchedAt, [queryId]: fetchedAt },
        errors: { ...state.errors, [queryId]: null }
      }
    }
    case 'inbox/queryErrorChanged':
      return {
        ...state,
        errors: { ...state.errors, [event.payload.queryId]: event.payload.error }
      }
    case 'inbox/queriesPruned': {
      const keep = new Set(event.payload.keepIds)
      return {
        byQueryId: pickKeys(state.byQueryId, keep),
        loading: pickKeys(state.loading, keep),
        totalCount: pickKeys(state.totalCount, keep),
        lastFetchedAt: pickKeys(state.lastFetchedAt, keep),
        errors: pickKeys(state.errors, keep)
      }
    }
    default: {
      const _exhaustive: never = event
      void _exhaustive
      return state
    }
  }
}
