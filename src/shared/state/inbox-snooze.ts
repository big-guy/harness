// Inbox-item snooze slice — mirrors the worktree `snooze` slice but keyed
// by inbox item (`<kind>:<owner>/<repo>#<number>`) instead of worktree path.
// A snoozed item is hidden from the Active list (shown greyed under
// "Snoozed") until either its `wakeAt` arrives OR the item changes on GitHub
// (its `updatedAt` advances — new comments, labels, edits, state all bump
// it), at which point the entry is cleared and the item returns to Active.

export type InboxSnoozeRef = {
  kind: string
  owner: string
  repo: string
  number: number
}

export interface InboxSnoozeEntry {
  /** `${kind}:${owner}/${repo}#${number}` — same scheme as InboxScreen's row key. */
  key: string
  snoozedAt: number
  wakeAt: number
  /** The item's `updatedAt` (ISO) at snooze time. The poller wakes the item
   *  when an incoming result has a different `updatedAt`. */
  updatedAt: string
}

export interface InboxSnoozeState {
  byKey: Record<string, InboxSnoozeEntry>
}

export type InboxSnoozeEvent =
  | { type: 'inboxSnooze/set'; payload: InboxSnoozeEntry }
  | { type: 'inboxSnooze/clear'; payload: string }

export const initialInboxSnooze: InboxSnoozeState = {
  byKey: {}
}

/** Stable key for an inbox item — matches the `itemKey` used in InboxScreen
 *  and the `mergeQueueByKey` convention. */
export function inboxSnoozeKey(ref: InboxSnoozeRef): string {
  return `${ref.kind}:${ref.owner}/${ref.repo}#${ref.number}`
}

export function inboxSnoozeReducer(
  state: InboxSnoozeState,
  event: InboxSnoozeEvent
): InboxSnoozeState {
  switch (event.type) {
    case 'inboxSnooze/set':
      return {
        ...state,
        byKey: { ...state.byKey, [event.payload.key]: event.payload }
      }
    case 'inboxSnooze/clear': {
      if (!(event.payload in state.byKey)) return state
      const next = { ...state.byKey }
      delete next[event.payload]
      return { ...state, byKey: next }
    }
    default: {
      const _exhaustive: never = event
      void _exhaustive
      return state
    }
  }
}
