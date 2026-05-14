import { describe, it, expect, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { setBadgeCount: () => true }
}))

import { countWorktreesNeedingApproval } from './dock-badge'
import type { PaneNode, PtyStatus } from '../shared/state/terminals'

function leaf(id: string, tabs: { id: string; type?: 'agent' | 'shell' | 'json-claude' | 'diff' }[]): PaneNode {
  return {
    type: 'leaf',
    id,
    tabs: tabs.map((t) => ({ id: t.id, type: t.type ?? 'agent', label: t.id })),
    activeTabId: tabs[0]?.id ?? ''
  }
}

describe('countWorktreesNeedingApproval', () => {
  it('returns 0 when no worktrees', () => {
    expect(countWorktreesNeedingApproval([], {}, {})).toBe(0)
  })

  it('counts one worktree whose tab is needs-approval', () => {
    const panes: Record<string, PaneNode> = { '/a': leaf('pa', [{ id: 't1' }]) }
    const statuses: Record<string, PtyStatus> = { t1: 'needs-approval' }
    expect(countWorktreesNeedingApproval(['/a'], panes, statuses)).toBe(1)
  })

  it('does not count waiting or processing or idle', () => {
    const panes: Record<string, PaneNode> = {
      '/a': leaf('pa', [{ id: 'ta' }]),
      '/b': leaf('pb', [{ id: 'tb' }]),
      '/c': leaf('pc', [{ id: 'tc' }])
    }
    const statuses: Record<string, PtyStatus> = {
      ta: 'waiting',
      tb: 'processing',
      tc: 'idle'
    }
    expect(countWorktreesNeedingApproval(['/a', '/b', '/c'], panes, statuses)).toBe(0)
  })

  it('aggregates per worktree — one needs-approval tab is enough', () => {
    const split: PaneNode = {
      type: 'split',
      id: 's',
      direction: 'horizontal',
      ratio: 0.5,
      children: [leaf('p1', [{ id: 't1' }]), leaf('p2', [{ id: 't2' }])]
    }
    const panes: Record<string, PaneNode> = { '/a': split }
    const statuses: Record<string, PtyStatus> = {
      t1: 'processing',
      t2: 'needs-approval'
    }
    expect(countWorktreesNeedingApproval(['/a'], panes, statuses)).toBe(1)
  })

  it('counts multiple worktrees independently', () => {
    const panes: Record<string, PaneNode> = {
      '/a': leaf('pa', [{ id: 'ta' }]),
      '/b': leaf('pb', [{ id: 'tb' }]),
      '/c': leaf('pc', [{ id: 'tc' }])
    }
    const statuses: Record<string, PtyStatus> = {
      ta: 'needs-approval',
      tb: 'idle',
      tc: 'needs-approval'
    }
    expect(countWorktreesNeedingApproval(['/a', '/b', '/c'], panes, statuses)).toBe(2)
  })

  it('ignores diff / file / browser tabs', () => {
    const panes: Record<string, PaneNode> = {
      '/a': leaf('pa', [{ id: 't1', type: 'diff' }])
    }
    const statuses: Record<string, PtyStatus> = { t1: 'needs-approval' }
    expect(countWorktreesNeedingApproval(['/a'], panes, statuses)).toBe(0)
  })

  it('returns 0 for a worktree with no pane tree', () => {
    expect(countWorktreesNeedingApproval(['/a'], {}, {})).toBe(0)
  })
})
