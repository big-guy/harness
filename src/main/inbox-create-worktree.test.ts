import { describe, it, expect } from 'vitest'
import { makeIssueBranchName } from './inbox-create-worktree'

describe('makeIssueBranchName', () => {
  it('slugifies a normal title', () => {
    expect(makeIssueBranchName(42, 'Fix the navbar dropdown')).toBe(
      'issue-42-fix-the-navbar-dropdown'
    )
  })

  it('caps slug at 40 chars and strips trailing hyphens', () => {
    const long = makeIssueBranchName(
      1,
      'a very long issue title that should be truncated to keep the branch reasonable'
    )
    expect(long.startsWith('issue-1-')).toBe(true)
    expect(long.length).toBeLessThanOrEqual(8 + 40)
    expect(long.endsWith('-')).toBe(false)
  })

  it('falls back to issue-<n> when title slugifies to empty', () => {
    expect(makeIssueBranchName(7, '!!!')).toBe('issue-7')
  })

  it('collapses runs of non-alphanumeric into single hyphens', () => {
    expect(makeIssueBranchName(3, 'foo / bar :: baz')).toBe('issue-3-foo-bar-baz')
  })
})
