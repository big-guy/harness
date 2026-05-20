import { describe, it, expect } from 'vitest'
import type { SessionUsage } from '../../shared/state/costs'
import type { PaneNode, TerminalTab } from '../../shared/state/terminals'
import {
  formatWorktreeAge,
  pickLatestWorktreeModel,
  shortModel
} from './worktree-detail'

// ---------------------------------------------------------------------------
// shortModel
// ---------------------------------------------------------------------------

describe('shortModel', () => {
  it('strips the claude- prefix and 8-digit date suffix', () => {
    expect(shortModel('claude-opus-4-7-20251022')).toBe('opus-4-7')
    expect(shortModel('claude-sonnet-4-5-20250929')).toBe('sonnet-4-5')
    expect(shortModel('claude-haiku-4-5-20251001')).toBe('haiku-4-5')
  })

  it('leaves models without a prefix or date suffix alone', () => {
    expect(shortModel('opus-4-7')).toBe('opus-4-7')
    expect(shortModel('claude-opus-4-7')).toBe('opus-4-7')
    expect(shortModel('opus-4-7-20251022')).toBe('opus-4-7')
  })

  it("doesn't strip non-8-digit trailing numbers", () => {
    expect(shortModel('claude-opus-4-7-2025102')).toBe('opus-4-7-2025102')
    expect(shortModel('claude-opus-4-7-202510222')).toBe('opus-4-7-202510222')
  })
})

// ---------------------------------------------------------------------------
// formatWorktreeAge
// ---------------------------------------------------------------------------

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR
const NOW = 1_700_000_000_000

describe('formatWorktreeAge', () => {
  it('returns em-dash when createdAt is missing', () => {
    expect(formatWorktreeAge(0, NOW)).toBe('—')
  })

  it('returns em-dash for clocks-in-the-future (negative age)', () => {
    expect(formatWorktreeAge(NOW + HOUR, NOW)).toBe('—')
  })

  it('returns <1h for anything under an hour', () => {
    expect(formatWorktreeAge(NOW - 30 * 60 * 1000, NOW)).toBe('<1h')
    expect(formatWorktreeAge(NOW - 59 * 60 * 1000 - 999, NOW)).toBe('<1h')
  })

  it('returns floored hours between 1h and 24h', () => {
    expect(formatWorktreeAge(NOW - HOUR, NOW)).toBe('1h')
    expect(formatWorktreeAge(NOW - 3 * HOUR, NOW)).toBe('3h')
    expect(formatWorktreeAge(NOW - 23 * HOUR, NOW)).toBe('23h')
  })

  it('returns floored days between 1d and one year', () => {
    expect(formatWorktreeAge(NOW - DAY, NOW)).toBe('1d')
    expect(formatWorktreeAge(NOW - 5 * DAY, NOW)).toBe('5d')
    expect(formatWorktreeAge(NOW - 364 * DAY, NOW)).toBe('364d')
  })

  it('switches to decimal-year format at >=365 days', () => {
    expect(formatWorktreeAge(NOW - 365 * DAY, NOW)).toBe('1.0y')
    expect(formatWorktreeAge(NOW - 540 * DAY, NOW)).toBe('1.5y')
    expect(formatWorktreeAge(NOW - 730 * DAY, NOW)).toBe('2.0y')
    expect(formatWorktreeAge(NOW - 1000 * DAY, NOW)).toBe('2.7y')
  })
})

// ---------------------------------------------------------------------------
// pickLatestWorktreeModel
// ---------------------------------------------------------------------------

function tab(overrides: Partial<TerminalTab> & { id: string; type: TerminalTab['type'] }): TerminalTab {
  return {
    label: overrides.id,
    ...overrides
  } as TerminalTab
}

function leafWith(...tabs: TerminalTab[]): PaneNode {
  return { type: 'leaf', id: 'p1', tabs, activeTabId: tabs[0]?.id ?? '' }
}

function splitOf(left: PaneNode, right: PaneNode): PaneNode {
  return {
    type: 'split',
    id: 'split-1',
    direction: 'horizontal',
    ratio: 0.5,
    children: [left, right]
  }
}

function usage(overrides: Partial<SessionUsage> & { currentModel: string | null; updatedAt: number }): SessionUsage {
  return {
    sessionId: 's',
    transcriptPath: '/tmp/x.jsonl',
    byModel: {},
    breakdown: {
      text: 0,
      thinking: 0,
      toolUse: 0,
      userPrompt: 0,
      assistantEcho: 0,
      toolResults: {}
    },
    ...overrides
  }
}

describe('pickLatestWorktreeModel', () => {
  it('returns empty string when the pane tree is missing', () => {
    expect(pickLatestWorktreeModel(undefined, {})).toBe('')
  })

  it('returns empty string when no agent tab has produced output yet', () => {
    const tree = leafWith(
      tab({ id: 't1', type: 'agent', agentKind: 'claude' }),
      tab({ id: 't2', type: 'shell' })
    )
    expect(pickLatestWorktreeModel(tree, {})).toBe('')
  })

  it('returns the currentModel from the only agent tab with cost data', () => {
    const tree = leafWith(tab({ id: 't1', type: 'agent', agentKind: 'claude' }))
    const byTerminal = {
      t1: usage({ currentModel: 'claude-opus-4-7-20251022', updatedAt: 5 })
    }
    expect(pickLatestWorktreeModel(tree, byTerminal)).toBe('claude-opus-4-7-20251022')
  })

  it('picks the model from the most recently updated tab when multiple agents have data', () => {
    const tree = leafWith(
      tab({ id: 't1', type: 'agent', agentKind: 'claude' }),
      tab({ id: 't2', type: 'json-claude' })
    )
    const byTerminal = {
      t1: usage({ currentModel: 'claude-opus-4-7-20251022', updatedAt: 10 }),
      t2: usage({ currentModel: 'claude-sonnet-4-5-20250929', updatedAt: 20 })
    }
    expect(pickLatestWorktreeModel(tree, byTerminal)).toBe('claude-sonnet-4-5-20250929')
  })

  it('walks across split panes to find the latest model', () => {
    const tree = splitOf(
      leafWith(tab({ id: 'a1', type: 'agent', agentKind: 'claude' })),
      leafWith(tab({ id: 'a2', type: 'agent', agentKind: 'claude' }))
    )
    const byTerminal = {
      a1: usage({ currentModel: 'claude-opus-4-7-20251022', updatedAt: 100 }),
      a2: usage({ currentModel: 'claude-haiku-4-5-20251001', updatedAt: 200 })
    }
    expect(pickLatestWorktreeModel(tree, byTerminal)).toBe('claude-haiku-4-5-20251001')
  })

  it('ignores shell and diff/file/browser tabs even when they show up in byTerminal', () => {
    const tree = leafWith(
      tab({ id: 'a1', type: 'agent', agentKind: 'claude' }),
      tab({ id: 's1', type: 'shell' }),
      tab({ id: 'd1', type: 'diff', filePath: 'x' }),
      tab({ id: 'b1', type: 'browser' })
    )
    const byTerminal = {
      a1: usage({ currentModel: 'claude-opus-4-7-20251022', updatedAt: 10 }),
      // A bogus higher-updatedAt entry on a non-agent id should never win
      s1: usage({ currentModel: 'claude-sonnet-4-5-20250929', updatedAt: 999 })
    }
    expect(pickLatestWorktreeModel(tree, byTerminal)).toBe('claude-opus-4-7-20251022')
  })

  it('skips usage rows whose currentModel is null', () => {
    const tree = leafWith(
      tab({ id: 'a1', type: 'agent', agentKind: 'claude' }),
      tab({ id: 'a2', type: 'agent', agentKind: 'claude' })
    )
    const byTerminal = {
      a1: usage({ currentModel: 'claude-opus-4-7-20251022', updatedAt: 10 }),
      a2: usage({ currentModel: null, updatedAt: 9999 })
    }
    expect(pickLatestWorktreeModel(tree, byTerminal)).toBe('claude-opus-4-7-20251022')
  })
})
