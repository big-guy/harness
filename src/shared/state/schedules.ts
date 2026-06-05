// Schedules slice — user-defined schedules shown in the Workflow overlay's
// "Schedule" tab. Each schedule fires a prompt at a chosen time, either once
// or on a repeat. A schedule targets a repository (durable — survives across
// worktrees of that repo) or a specific worktree (temporary — pruned when the
// worktree goes away).
//
// This is shared world state: every client viewing the workspace should see
// the same list, so it lives in a slice (persisted to config.json) rather
// than renderer useState.

export type ScheduleRepeat = 'once' | 'daily' | 'weekdays' | 'weekly' | 'monthly'

export const SCHEDULE_REPEATS: ScheduleRepeat[] = [
  'once',
  'daily',
  'weekdays',
  'weekly',
  'monthly'
]

/** Where a schedule runs. A repo target is durable; a worktree target is
 *  temporary and pruned when that worktree disappears. `repoRoot` is carried
 *  on the worktree variant too so the UI can label it without a lookup. */
export type ScheduleTarget =
  | { kind: 'repo'; repoRoot: string }
  | { kind: 'worktree'; worktreePath: string; repoRoot: string }

export interface Schedule {
  id: string
  title: string
  /** ISO datetime of the next (or only) occurrence. */
  at: string
  repeat: ScheduleRepeat
  /** Prompt sent to the agent when the schedule fires. */
  prompt: string
  target: ScheduleTarget
  /** Paused schedules stay in the list but don't fire. */
  enabled: boolean
  /** ISO datetime the schedule was created. */
  createdAt: string
  /** ISO datetime of the most recent fire. Unset until the schedule has run
   *  at least once — used to tell "Upcoming" (never run) from "Past" (ran,
   *  worktree gone). */
  lastRunAt?: string
  /** Worktree associated with the most recent run. For a worktree target this
   *  mirrors target.worktreePath; for a repo target it's the worktree the
   *  fire created. Its liveness decides "Active" vs "Past". */
  lastWorktreePath?: string
  /** Summary the agent reported when it signaled the scheduled work was done
   *  (via the MCP complete endpoint). Shown on Past rows. */
  lastSummary?: string
}

/** Which lifecycle bucket a schedule belongs to in the Schedule tab. */
export type ScheduleCategory = 'upcoming' | 'active' | 'past'

export interface SchedulesState {
  /** All schedules, newest occurrence first is NOT guaranteed — the UI sorts. */
  items: Schedule[]
}

export type SchedulesEvent =
  | { type: 'schedules/loaded'; payload: Schedule[] }
  | { type: 'schedules/added'; payload: Schedule }
  | { type: 'schedules/updated'; payload: Schedule }
  | { type: 'schedules/removed'; payload: { id: string } }

export const initialSchedules: SchedulesState = { items: [] }

function isRepeat(v: unknown): v is ScheduleRepeat {
  return typeof v === 'string' && (SCHEDULE_REPEATS as string[]).includes(v)
}

/** Validate + normalize a single untrusted schedule-ish object. Returns null
 *  when required fields are missing/invalid. */
export function sanitizeSchedule(raw: unknown): Schedule | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const id = typeof r.id === 'string' ? r.id.trim() : ''
  const title = typeof r.title === 'string' ? r.title.trim() : ''
  const at = typeof r.at === 'string' ? r.at : ''
  const prompt = typeof r.prompt === 'string' ? r.prompt : ''
  if (!id || !title || !at) return null
  if (!Number.isFinite(new Date(at).getTime())) return null

  const t = r.target as Record<string, unknown> | undefined
  let target: ScheduleTarget | null = null
  if (t && typeof t === 'object') {
    const repoRoot = typeof t.repoRoot === 'string' ? t.repoRoot.trim() : ''
    if (t.kind === 'repo' && repoRoot) {
      target = { kind: 'repo', repoRoot }
    } else if (t.kind === 'worktree') {
      const worktreePath =
        typeof t.worktreePath === 'string' ? t.worktreePath.trim() : ''
      if (worktreePath && repoRoot) {
        target = { kind: 'worktree', worktreePath, repoRoot }
      }
    }
  }
  if (!target) return null

  return {
    id,
    title,
    at,
    repeat: isRepeat(r.repeat) ? r.repeat : 'once',
    prompt,
    target,
    enabled: r.enabled !== false,
    createdAt: typeof r.createdAt === 'string' ? r.createdAt : at,
    ...(typeof r.lastRunAt === 'string' ? { lastRunAt: r.lastRunAt } : {}),
    ...(typeof r.lastWorktreePath === 'string' && r.lastWorktreePath
      ? { lastWorktreePath: r.lastWorktreePath }
      : {}),
    ...(typeof r.lastSummary === 'string' && r.lastSummary
      ? { lastSummary: r.lastSummary }
      : {})
  }
}

/** The worktree associated with a schedule, if any — for liveness checks. */
export function scheduleWorktreePath(s: Schedule): string | null {
  if (s.target.kind === 'worktree') return s.target.worktreePath
  return s.lastWorktreePath ?? null
}

/** Bucket a schedule for the Schedule tab. A live associated worktree means
 *  it's running now ("Active"); otherwise an enabled future time means it's
 *  waiting ("Upcoming"); a schedule that has already run with no live
 *  worktree is "Past". Repeating schedules naturally oscillate Active ↔
 *  Upcoming and never get stuck in Past. */
export function categorizeSchedule(
  s: Schedule,
  liveWorktreePaths: Set<string>,
  now: number
): ScheduleCategory {
  const wt = scheduleWorktreePath(s)
  if (wt && liveWorktreePaths.has(wt)) return 'active'
  const at = Date.parse(s.at)
  const future = Number.isFinite(at) && at > now
  // Upcoming means it will actually run again: enabled with a future time.
  if (s.enabled && future) return 'upcoming'
  // Anything with a past/invalid time, or that has already run, is in the
  // past — only a still-future (e.g. paused) schedule stays Upcoming.
  if (s.lastRunAt || !future) return 'past'
  return 'upcoming'
}

/** Validate + normalize an untrusted array of schedules. Drops invalid
 *  entries and dedups by id (first occurrence wins). */
export function sanitizeSchedules(raw: unknown): Schedule[] {
  if (!Array.isArray(raw)) return []
  const out: Schedule[] = []
  const seen = new Set<string>()
  for (const item of raw) {
    const s = sanitizeSchedule(item)
    if (!s || seen.has(s.id)) continue
    seen.add(s.id)
    out.push(s)
  }
  return out
}

function isWeekend(d: Date): boolean {
  return d.getDay() === 0 || d.getDay() === 6
}

/** The next occurrence strictly after `now` for a repeating schedule, as an
 *  ISO string. Returns null for one-time schedules (they don't recur). Steps
 *  forward from `at` by the repeat interval — so a schedule that missed
 *  several intervals (app was closed) lands on the next future slot, not a
 *  burst of past ones. */
export function nextOccurrence(
  at: string,
  repeat: ScheduleRepeat,
  now: number
): string | null {
  if (repeat === 'once') return null
  let d = new Date(at)
  if (!Number.isFinite(d.getTime())) return null

  const step = (date: Date): Date => {
    const n = new Date(date)
    switch (repeat) {
      case 'daily':
        n.setDate(n.getDate() + 1)
        break
      case 'weekly':
        n.setDate(n.getDate() + 7)
        break
      case 'monthly':
        n.setMonth(n.getMonth() + 1)
        break
      case 'weekdays':
        do {
          n.setDate(n.getDate() + 1)
        } while (isWeekend(n))
        break
    }
    return n
  }

  let guard = 0
  do {
    d = step(d)
    guard++
  } while (d.getTime() <= now && guard < 100_000)

  // A weekdays schedule whose seed `at` fell on a weekend should still land
  // on a weekday even when the loop above ran zero effective steps.
  if (repeat === 'weekdays') {
    while (isWeekend(d)) d = step(d)
  }

  return d.toISOString()
}

export function schedulesReducer(
  state: SchedulesState,
  event: SchedulesEvent
): SchedulesState {
  switch (event.type) {
    case 'schedules/loaded':
      return { items: event.payload }
    case 'schedules/added': {
      // Upsert by id — re-adding an existing id replaces it in place.
      const i = state.items.findIndex((s) => s.id === event.payload.id)
      if (i === -1) return { items: [...state.items, event.payload] }
      return {
        items: [
          ...state.items.slice(0, i),
          event.payload,
          ...state.items.slice(i + 1)
        ]
      }
    }
    case 'schedules/updated': {
      const i = state.items.findIndex((s) => s.id === event.payload.id)
      if (i === -1) return state
      return {
        items: [
          ...state.items.slice(0, i),
          event.payload,
          ...state.items.slice(i + 1)
        ]
      }
    }
    case 'schedules/removed': {
      const i = state.items.findIndex((s) => s.id === event.payload.id)
      if (i === -1) return state
      return {
        items: [...state.items.slice(0, i), ...state.items.slice(i + 1)]
      }
    }
    default:
      return state
  }
}
