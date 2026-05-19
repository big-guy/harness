import { describe, it, expect } from 'vitest'
import { makeIssueBranchName, makePRBranchName } from './inbox-create-worktree'

describe('makeIssueBranchName', () => {
  it('slugifies a normal title with default prefix', () => {
    expect(makeIssueBranchName(42, 'Fix the navbar dropdown', 'issue-')).toBe(
      'issue-42-fix-the-navbar-dropdown'
    )
  })

  it('respects a custom prefix', () => {
    expect(makeIssueBranchName(42, 'Fix it', 'sg/work-')).toBe('sg/work-42-fix-it')
  })

  it('caps slug at 40 chars and strips trailing hyphens', () => {
    const long = makeIssueBranchName(
      1,
      'a very long issue title that should be truncated to keep the branch reasonable',
      'issue-'
    )
    expect(long.startsWith('issue-1-')).toBe(true)
    expect(long.length).toBeLessThanOrEqual(8 + 40)
    expect(long.endsWith('-')).toBe(false)
  })

  it('falls back to prefix+n when title slugifies to empty', () => {
    expect(makeIssueBranchName(7, '!!!', 'issue-')).toBe('issue-7')
    expect(makeIssueBranchName(7, '!!!', 'bg/')).toBe('bg/7')
  })

  it('collapses runs of non-alphanumeric into single hyphens', () => {
    expect(makeIssueBranchName(3, 'foo / bar :: baz', 'issue-')).toBe('issue-3-foo-bar-baz')
  })
})

describe('makePRBranchName', () => {
  it('formats with the default prefix', () => {
    expect(makePRBranchName(1234, 'pr/')).toBe('pr/1234')
  })

  it('respects a custom prefix', () => {
    expect(makePRBranchName(99, 'review-')).toBe('review-99')
  })
})
