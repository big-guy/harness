import type { Store } from './store'
import { nextOccurrence, type Schedule } from '../shared/state/schedules'
import { log } from './debug'

// A backstop scan so a schedule fires within a minute of its time even if the
// precise wake timer was missed (system sleep, clock jump, long delay).
const SAFETY_SCAN_MS = 60_000
// setTimeout overflows past ~24.8 days; clamp long waits and let the safety
// scan carry the rest.
const MAX_TIMEOUT_MS = 2_147_483_647

interface ScheduleRunnerOptions {
  /** Perform the side effect for a due schedule (create a worktree, send a
   *  prompt to an agent, …). Called after the schedule's state has already
   *  been advanced/disabled, so a throw here can't cause a re-fire. */
  fire: (schedule: Schedule) => void | Promise<void>
}

/** Fires Workflow schedules at their appointed time. Mirrors the
 *  InboxSnoozeTimer shape: a precise wake timer for the soonest schedule plus
 *  a 60s safety scan, both funneling into `scan()`. Lives in main so
 *  schedules fire even with no renderer attached (headless). Also prunes
 *  worktree-scoped schedules when their worktree is deleted — those are
 *  defined as temporary. */
export class ScheduleRunner {
  private store: Store
  private opts: ScheduleRunnerOptions
  private unsubscribe: (() => void) | null = null
  private wakeTimer: ReturnType<typeof setTimeout> | null = null
  private safetyTimer: ReturnType<typeof setInterval> | null = null

  constructor(store: Store, opts: ScheduleRunnerOptions) {
    this.store = store
    this.opts = opts
  }

  start(): void {
    if (this.unsubscribe) return
    this.unsubscribe = this.store.subscribe((event) => {
      if (event.type.startsWith('schedules/')) {
        this.reschedule()
      } else if (event.type === 'worktrees/listChanged') {
        this.prune()
      }
    })
    this.safetyTimer = setInterval(() => this.scan(), SAFETY_SCAN_MS)
    this.prune()
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

  /** Fire every enabled schedule whose time has arrived. */
  scan(): void {
    const now = Date.now()
    for (const s of this.store.getSnapshot().state.schedules.items) {
      if (!s.enabled) continue
      const t = Date.parse(s.at)
      if (!Number.isFinite(t) || t > now) continue
      this.fireOne(s, now)
    }
  }

  private fireOne(schedule: Schedule, now: number): void {
    // Advance (or disable) BEFORE the side effect so a throw or a re-entrant
    // scan can't double-fire the same slot. Stamp lastRunAt so the schedule
    // is no longer "never run" (Upcoming) once it has fired.
    const next = nextOccurrence(schedule.at, schedule.repeat, now)
    const base = { ...schedule, lastRunAt: new Date(now).toISOString() }
    this.store.dispatch({
      type: 'schedules/updated',
      payload: next ? { ...base, at: next } : { ...base, enabled: false }
    })
    try {
      const r = this.opts.fire(schedule)
      if (r && typeof (r as Promise<void>).catch === 'function') {
        ;(r as Promise<void>).catch((err) =>
          log('schedule-runner', `fire failed for ${schedule.id}`, err)
        )
      }
    } catch (err) {
      log('schedule-runner', `fire threw for ${schedule.id}`, err)
    }
  }

  /** Drop worktree-scoped schedules that never ran once their worktree is
   *  gone — they're temporary and can no longer fire. A worktree-scoped
   *  schedule that HAS run is kept so it surfaces under "Past". */
  private prune(): void {
    const snap = this.store.getSnapshot().state
    const paths = new Set(snap.worktrees.list.map((w) => w.path))
    for (const s of snap.schedules.items) {
      if (
        s.target.kind === 'worktree' &&
        !paths.has(s.target.worktreePath) &&
        !s.lastRunAt
      ) {
        this.store.dispatch({ type: 'schedules/removed', payload: { id: s.id } })
      }
    }
  }

  private reschedule(): void {
    if (this.wakeTimer) {
      clearTimeout(this.wakeTimer)
      this.wakeTimer = null
    }
    let soonest = Infinity
    for (const s of this.store.getSnapshot().state.schedules.items) {
      if (!s.enabled) continue
      const t = Date.parse(s.at)
      if (Number.isFinite(t) && t < soonest) soonest = t
    }
    if (!Number.isFinite(soonest)) return
    const delay = Math.min(MAX_TIMEOUT_MS, Math.max(0, soonest - Date.now()))
    this.wakeTimer = setTimeout(() => {
      this.wakeTimer = null
      this.scan()
      this.reschedule()
    }, delay)
  }
}
