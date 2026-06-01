import { describe, it, expect } from 'vitest'
import { detectMilestoneRegex } from './inbox-poller'

describe('detectMilestoneRegex', () => {
  it('returns null for queries with no milestone clause', () => {
    expect(detectMilestoneRegex('is:open is:pr review-requested:@me')).toBeNull()
  })

  it('returns null for literal milestone clauses (no metacharacters)', () => {
    expect(detectMilestoneRegex('is:open milestone:"v1.x"')).toBe('v1.x') // . is meta
    expect(detectMilestoneRegex('is:open milestone:"plain"')).toBeNull()
    expect(detectMilestoneRegex('is:open milestone:plain-name')).toBeNull()
  })

  it('detects regex metacharacters in a milestone value', () => {
    expect(detectMilestoneRegex('is:open milestone:"release-.+"')).toBe('release-.+')
    expect(detectMilestoneRegex('is:open milestone:".*"')).toBe('.*')
    expect(detectMilestoneRegex("is:open milestone:'(alpha|beta)'")).toBe('(alpha|beta)')
  })

  it('returns the first regex-flavored clause when multiple are present', () => {
    expect(
      detectMilestoneRegex('milestone:plain milestone:"release-.+" milestone:"v2.*"')
    ).toBe('release-.+')
  })
})
