import { log } from './debug'
import {
  searchIssues,
  listMilestones,
  parseRepoClauses,
  stripMilestoneClauses,
  type SearchIssuesItem
} from './github'
import { getRepoOriginInfo } from './git-remote-info'
import type { Store } from './store'
import type { InboxQuery } from '../shared/state/settings'

// Cap on the number of matched milestones we'll fan out into per-milestone
// searches. Each match is one Search API call; the 30 req/min limit means
// we need to bound this. A user whose regex matches more should refine.
const MAX_MILESTONES_PER_QUERY = 5

// Search API is 30 req/min authenticated and has a hard 1000-result cap.
// Two minutes between full sweeps keeps us comfortably under that even
// with a handful of configured queries plus focus-driven stale refreshes.
const POLL_INTERVAL_MS = 2 * 60 * 1000
const STALE_WINDOW_MS = 60 * 1000

interface InboxPollerOptions {
  getQueries: () => InboxQuery[]
  /** Tracked repo roots in the workspace. Used to enumerate milestone
   *  candidates when a query with milestoneRegex has no `repo:` clause. */
  getRepoRoots: () => string[]
}

/** Owns background inbox polling. One GitHub search call per configured
 *  query per cycle. Writes go through the store; the renderer mirrors via
 *  the `inbox` slice. */
export class InboxPoller {
  private store: Store
  private opts: InboxPollerOptions
  private timer: NodeJS.Timeout | null = null
  private inFlight = new Set<string>()
  private lastFetchAt = new Map<string, number>()

  constructor(store: Store, opts: InboxPollerOptions) {
    this.store = store
    this.opts = opts
  }

  start(): void {
    if (this.timer) return
    this.timer = setInterval(() => {
      void this.refreshAll()
    }, POLL_INTERVAL_MS)
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  /** Refresh every configured query. Per-query fetches run in parallel. */
  async refreshAll(): Promise<void> {
    const queries = this.opts.getQueries()
    if (queries.length === 0) return
    await Promise.all(queries.map((q) => this.refreshOne(q)))
  }

  /** Refresh a single query by id. Looks up the query string from the
   *  current settings — call sites only need to pass the id. */
  async refreshById(queryId: string): Promise<void> {
    const q = this.opts.getQueries().find((qq) => qq.id === queryId)
    if (!q) return
    await this.refreshOne(q)
  }

  /** Re-poll any query whose last fetch is older than STALE_WINDOW_MS.
   *  Used on window focus so rapid alt-tabbing doesn't hammer the search
   *  API. */
  refreshAllIfStale(): void {
    const now = Date.now()
    for (const q of this.opts.getQueries()) {
      const last = this.lastFetchAt.get(q.id) ?? 0
      if (now - last > STALE_WINDOW_MS) {
        void this.refreshOne(q)
      }
    }
  }

  /** Drop any in-memory bookkeeping for queries that no longer exist.
   *  The store-side prune is dispatched separately by the host. */
  pruneTo(keepIds: string[]): void {
    const keep = new Set(keepIds)
    for (const id of [...this.lastFetchAt.keys()]) {
      if (!keep.has(id)) this.lastFetchAt.delete(id)
    }
    for (const id of [...this.inFlight]) {
      if (!keep.has(id)) this.inFlight.delete(id)
    }
  }

  private async refreshOne(q: InboxQuery): Promise<void> {
    if (this.inFlight.has(q.id)) return
    this.inFlight.add(q.id)
    this.store.dispatch({
      type: 'inbox/queryLoadingChanged',
      payload: { queryId: q.id, loading: true }
    })
    try {
      const inlineRegex = detectMilestoneRegex(q.query)
      const result = inlineRegex
        ? await this.runWithMilestoneRegex(q, inlineRegex)
        : await this.runSimple(q.query)
      if (result === null) {
        this.store.dispatch({
          type: 'inbox/queryErrorChanged',
          payload: { queryId: q.id, error: 'Connect GitHub to use the inbox' }
        })
        return
      }
      const now = Date.now()
      this.lastFetchAt.set(q.id, now)
      this.store.dispatch({
        type: 'inbox/queryResultChanged',
        payload: {
          queryId: q.id,
          items: result.items.map(toInboxItem),
          totalCount: result.totalCount,
          fetchedAt: now
        }
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      log('inbox-poller', `refresh failed for ${q.id}`, msg)
      this.store.dispatch({
        type: 'inbox/queryErrorChanged',
        payload: { queryId: q.id, error: msg }
      })
    } finally {
      this.inFlight.delete(q.id)
      this.store.dispatch({
        type: 'inbox/queryLoadingChanged',
        payload: { queryId: q.id, loading: false }
      })
    }
  }

  /** No-regex path: single search call, items already in updated-desc order. */
  private async runSimple(
    query: string
  ): Promise<{ items: SearchIssuesItem[]; totalCount: number } | null> {
    return await searchIssues(query)
  }

  /** milestoneRegex path: enumerate candidate repos' milestones, regex
   *  match titles, then run one scoped search per matched (repo, title)
   *  and merge results. */
  private async runWithMilestoneRegex(
    q: InboxQuery,
    regexSource: string
  ): Promise<{ items: SearchIssuesItem[]; totalCount: number } | null> {
    let regex: RegExp
    try {
      regex = new RegExp(regexSource)
    } catch (err) {
      throw new Error(
        `Invalid milestone regex: ${err instanceof Error ? err.message : String(err)}`
      )
    }

    // Candidate repos: explicit repo: clauses in the query, else fall back
    // to every tracked repoRoot mapped through its origin URL.
    const explicit = parseRepoClauses(q.query)
    let candidates: { owner: string; repo: string }[]
    if (explicit.length > 0) {
      candidates = explicit
    } else {
      candidates = []
      for (const root of this.opts.getRepoRoots()) {
        const parsed = await getRepoOriginInfo(root)
        if (parsed) candidates.push(parsed)
      }
      if (candidates.length === 0) {
        throw new Error(
          'milestone:"…regex…" needs a `repo:` clause in the query or at least one tracked repository'
        )
      }
    }

    // Resolve matched milestones per repo.
    const matches: { owner: string; repo: string; title: string }[] = []
    for (const c of candidates) {
      let ms: { title: string; state: 'open' | 'closed' }[]
      try {
        ms = await listMilestones(c.owner, c.repo)
      } catch {
        continue
      }
      for (const m of ms) {
        if (regex.test(m.title)) {
          matches.push({ owner: c.owner, repo: c.repo, title: m.title })
          if (matches.length >= MAX_MILESTONES_PER_QUERY) break
        }
      }
      if (matches.length >= MAX_MILESTONES_PER_QUERY) break
    }

    if (matches.length === 0) {
      return { items: [], totalCount: 0 }
    }

    const baseQuery = stripMilestoneClauses(q.query)
    // Run scoped searches in parallel. Each call is bounded to a specific
    // repo+milestone, so dedupe across calls is unlikely; we sum totals
    // honestly and dedupe items defensively by composite key.
    const scoped = await Promise.all(
      matches.map(async (m) => {
        const scopedQuery = `${baseQuery} repo:${m.owner}/${m.repo} milestone:"${m.title}"`.trim()
        return await searchIssues(scopedQuery)
      })
    )

    let totalCount = 0
    const seen = new Set<string>()
    const items: SearchIssuesItem[] = []
    for (const r of scoped) {
      if (!r) return null
      totalCount += r.totalCount
      for (const it of r.items) {
        const key = `${it.kind}:${it.owner}/${it.repo}#${it.number}`
        if (seen.has(key)) continue
        seen.add(key)
        items.push(it)
      }
    }
    items.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    if (items.length > 100) items.length = 100
    return { items, totalCount }
  }
}

/** Walk the query for `milestone:` clauses. If any clause's value contains
 *  regex metacharacters, return that value (the regex source); otherwise
 *  return null and let GitHub's exact-match handle the literal clause. */
export function detectMilestoneRegex(query: string): string | null {
  const re = /\bmilestone:("[^"]*"|'[^']*'|\S+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(query)) !== null) {
    let val = m[1]
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1)
    }
    if (/[.*+?()[\]^$\\|{}]/.test(val)) return val
  }
  return null
}

function toInboxItem(it: SearchIssuesItem): {
  kind: 'issue' | 'pr'
  owner: string
  repo: string
  number: number
  title: string
  url: string
  state: 'open' | 'closed'
  author: { login: string; avatarUrl: string } | null
  labels: { name: string; color: string }[]
  assignees: { login: string; avatarUrl: string }[]
  createdAt: string
  updatedAt: string
  commentCount: number
  bodyPreview: string | null
  milestone: { title: string; state: 'open' | 'closed'; number: number } | null
} {
  return {
    kind: it.kind,
    owner: it.owner,
    repo: it.repo,
    number: it.number,
    title: it.title,
    url: it.url,
    state: it.state,
    author: it.author,
    labels: it.labels,
    assignees: it.assignees,
    createdAt: it.createdAt,
    updatedAt: it.updatedAt,
    commentCount: it.commentCount,
    bodyPreview: it.bodyPreview,
    milestone: it.milestone
  }
}

