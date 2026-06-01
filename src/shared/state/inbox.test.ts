import { describe, it, expect } from 'vitest'
import { initialInbox, inboxReducer, type InboxItem } from './inbox'

const sampleItem = (n: number): InboxItem => ({
  kind: 'pr',
  owner: 'acme',
  repo: 'widgets',
  number: n,
  title: `PR ${n}`,
  url: `https://github.com/acme/widgets/pull/${n}`,
  state: 'open',
  author: { login: 'alice', avatarUrl: '' },
  labels: [],
  assignees: [],
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  commentCount: 0,
  bodyPreview: null,
  milestone: null
})

describe('inboxReducer', () => {
  it('queryLoadingChanged sets per-query loading flag', () => {
    const s = inboxReducer(initialInbox, {
      type: 'inbox/queryLoadingChanged',
      payload: { queryId: 'q1', loading: true }
    })
    expect(s.loading.q1).toBe(true)
  })

  it('queryResultChanged writes items + totalCount + fetchedAt, clears error', () => {
    const withError = inboxReducer(initialInbox, {
      type: 'inbox/queryErrorChanged',
      payload: { queryId: 'q1', error: 'oh no' }
    })
    expect(withError.errors.q1).toBe('oh no')

    const next = inboxReducer(withError, {
      type: 'inbox/queryResultChanged',
      payload: {
        queryId: 'q1',
        items: [sampleItem(1), sampleItem(2)],
        totalCount: 247,
        fetchedAt: 12345
      }
    })
    expect(next.byQueryId.q1).toHaveLength(2)
    expect(next.totalCount.q1).toBe(247)
    expect(next.lastFetchedAt.q1).toBe(12345)
    expect(next.errors.q1).toBeNull()
  })

  it('queryErrorChanged sets per-query error', () => {
    const next = inboxReducer(initialInbox, {
      type: 'inbox/queryErrorChanged',
      payload: { queryId: 'q1', error: 'rate limited' }
    })
    expect(next.errors.q1).toBe('rate limited')
  })

  it('queriesPruned drops every map entry not in keepIds', () => {
    let s = initialInbox
    s = inboxReducer(s, {
      type: 'inbox/queryResultChanged',
      payload: { queryId: 'keep', items: [sampleItem(1)], totalCount: 1, fetchedAt: 1 }
    })
    s = inboxReducer(s, {
      type: 'inbox/queryResultChanged',
      payload: { queryId: 'drop', items: [sampleItem(2)], totalCount: 1, fetchedAt: 1 }
    })
    s = inboxReducer(s, {
      type: 'inbox/queryLoadingChanged',
      payload: { queryId: 'drop', loading: true }
    })

    const next = inboxReducer(s, {
      type: 'inbox/queriesPruned',
      payload: { keepIds: ['keep'] }
    })
    expect(Object.keys(next.byQueryId)).toEqual(['keep'])
    expect(Object.keys(next.loading)).toEqual([])
    expect(Object.keys(next.totalCount)).toEqual(['keep'])
  })
})
