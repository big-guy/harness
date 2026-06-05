import type { Store } from './store'
import { MAX_WAKE } from '../shared/state/snooze'

const SAFETY_SCAN_MS = 60_000

/** Watches `state.inboxSnooze.byKey` and clears entries when their `wakeAt`
 *  arrives. Mirror of SnoozeTimer (worktree snooze), keyed by inbox item.
 *  Wake-on-change (item updated on GitHub) is handled separately by the
 *  poller's result subscriber in index.ts; this only covers the timer. */
export class InboxSnoozeTimer {
  private store: Store
  private unsubscribe: (() => void) | null = null
  private wakeTimer: ReturnType<typeof setTimeout> | null = null
  private safetyTimer: ReturnType<typeof setInterval> | null = null

  constructor(store: Store) {
    this.store = store
  }

  start(): void {
    if (this.unsubscribe) return
    this.unsubscribe = this.store.subscribe((event) => {
      if (event.type === 'inboxSnooze/set' || event.type === 'inboxSnooze/clear') {
        this.reschedule()
      }
    })
    this.safetyTimer = setInterval(() => this.scan(), SAFETY_SCAN_MS)
    this.scan()
    this.reschedule()
  }

  stop(): void {
    if (this.unsubscribe) {
      this.unsubscribe()
      this.unsubscribe = null
    }
    if (this.wakeTimer) {
      clearTimeout(this.wakeTimer)
      this.wakeTimer = null
    }
    if (this.safetyTimer) {
      clearInterval(this.safetyTimer)
      this.safetyTimer = null
    }
  }

  private scan(): void {
    const now = Date.now()
    const byKey = this.store.getSnapshot().state.inboxSnooze.byKey
    for (const entry of Object.values(byKey)) {
      if (entry.wakeAt !== MAX_WAKE && now >= entry.wakeAt) {
        this.store.dispatch({ type: 'inboxSnooze/clear', payload: entry.key })
      }
    }
  }

  private reschedule(): void {
    if (this.wakeTimer) {
      clearTimeout(this.wakeTimer)
      this.wakeTimer = null
    }
    const byKey = this.store.getSnapshot().state.inboxSnooze.byKey
    let soonest = Infinity
    for (const entry of Object.values(byKey)) {
      if (entry.wakeAt === MAX_WAKE) continue
      if (entry.wakeAt < soonest) soonest = entry.wakeAt
    }
    if (!Number.isFinite(soonest)) return
    const delay = Math.max(0, soonest - Date.now())
    this.wakeTimer = setTimeout(() => {
      this.wakeTimer = null
      this.scan()
      this.reschedule()
    }, delay)
  }
}
