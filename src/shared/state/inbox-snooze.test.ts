import { describe, it, expect } from 'vitest'
import {
  inboxSnoozeReducer,
  inboxSnoozeKey,
  initialInboxSnooze,
  type InboxSnoozeEntry,
  type InboxSnoozeState
} from './inbox-snooze'

const entry = (over: Partial<InboxSnoozeEntry> = {}): InboxSnoozeEntry => ({
  key: 'issue:o/r#1',
  snoozedAt: 1000,
  wakeAt: 2000,
  updatedAt: '2024-01-01T00:00:00Z',
  ...over
})

describe('inboxSnoozeKey', () => {
  it('formats <kind>:<owner>/<repo>#<number>', () => {
    expect(inboxSnoozeKey({ kind: 'pr', owner: 'big-guy', repo: 'harness', number: 42 })).toBe(
      'pr:big-guy/harness#42'
    )
  })
})

describe('inboxSnoozeReducer', () => {
  it('inboxSnooze/set adds (and replaces) an entry by key', () => {
    const e = entry()
    const next = inboxSnoozeReducer(initialInboxSnooze, { type: 'inboxSnooze/set', payload: e })
    expect(next.byKey[e.key]).toEqual(e)

    const updated = entry({ wakeAt: 9999 })
    const after = inboxSnoozeReducer(next, { type: 'inboxSnooze/set', payload: updated })
    expect(after.byKey[e.key].wakeAt).toBe(9999)
  })

  it('inboxSnooze/clear removes the entry', () => {
    const e = entry()
    const seeded: InboxSnoozeState = { byKey: { [e.key]: e } }
    const next = inboxSnoozeReducer(seeded, { type: 'inboxSnooze/clear', payload: e.key })
    expect(next.byKey[e.key]).toBeUndefined()
  })

  it('inboxSnooze/clear on a missing key returns the same reference', () => {
    const seeded: InboxSnoozeState = { byKey: { 'issue:o/r#1': entry() } }
    const next = inboxSnoozeReducer(seeded, { type: 'inboxSnooze/clear', payload: 'pr:o/r#99' })
    expect(next).toBe(seeded)
  })
})
