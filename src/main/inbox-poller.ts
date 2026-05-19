import { log } from './debug'
import { searchIssues } from './github'
import type { Store } from './store'
import type { InboxQuery } from '../shared/state/settings'

// Search API is 30 req/min authenticated and has a hard 1000-result cap.
// Two minutes between full sweeps keeps us comfortably under that even
// with a handful of configured queries plus focus-driven stale refreshes.
const POLL_INTERVAL_MS = 2 * 60 * 1000
const STALE_WINDOW_MS = 60 * 1000

interface InboxPollerOptions {
  getQueries: () => InboxQuery[]
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
      const result = await searchIssues(q.query)
      if (result === null) {
        // No token — surface as an error so the UI can prompt for one.
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
          items: result.items.map((it) => ({
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
            bodyPreview: it.bodyPreview
          })),
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
}
