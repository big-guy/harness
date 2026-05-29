import { describe, it, expect, vi } from 'vitest'
import { Store } from './store'
import { PanesFSM } from './panes-fsm'
import type { PaneLeaf, PaneNode, TerminalTab } from '../shared/state/terminals'

vi.mock('./perf-log', () => ({
  perfLog: vi.fn(),
  getPerfLogFilePath: vi.fn(() => '/tmp/perf.log')
}))

vi.mock('./debug', () => ({
  log: vi.fn()
}))

function buildFSM(): { fsm: PanesFSM; store: Store } {
  const store = new Store()
  const fsm = new PanesFSM(store, {
    persist: () => {},
    getRepoRootForWorktree: () => undefined,
    getLatestClaudeSessionId: async () => null
  })
  return { fsm, store }
}

function seedLeaf(store: Store, wtPath: string, leaf: PaneLeaf): void {
  store.dispatch({
    type: 'terminals/panesForWorktreeChanged',
    payload: { worktreePath: wtPath, panes: leaf }
  })
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

describe('PanesFSM.splitPane', () => {
  it('mints a UUID id for a json-claude clone so the Claude CLI accepts --session-id', () => {
    const { fsm, store } = buildFSM()
    const wtPath = '/wt/json'
    const sourceTabId = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa'
    const sourceTab: TerminalTab = {
      id: sourceTabId,
      type: 'json-claude',
      label: 'Chat',
      sessionId: sourceTabId,
      mode: 'awake',
      model: 'opus'
    }
    const sourcePane: PaneLeaf = {
      type: 'leaf',
      id: 'pane-source',
      tabs: [sourceTab],
      activeTabId: sourceTabId
    }
    seedLeaf(store, wtPath, sourcePane)

    const newPane = fsm.splitPane(wtPath, 'pane-source', 'horizontal')

    expect(newPane).not.toBeNull()
    expect(newPane!.tabs).toHaveLength(1)
    const cloned = newPane!.tabs[0]
    expect(cloned.type).toBe('json-claude')
    expect(cloned.id).toMatch(UUID_RE)
    expect(cloned.id).not.toBe(sourceTabId)
    // tab.id and sessionId must agree — Chat tabs treat them as one value
    expect(cloned.sessionId).toBe(cloned.id)
    expect(cloned.mode).toBe('awake')
    // Inherits the source's model + label
    expect(cloned.model).toBe('opus')
    expect(cloned.label).toBe('Chat')
  })

  it('does not carry over initialPrompt/teleportSessionId from the source chat', () => {
    const { fsm, store } = buildFSM()
    const wtPath = '/wt/json2'
    const sourceTabId = 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb'
    const sourceTab: TerminalTab = {
      id: sourceTabId,
      type: 'json-claude',
      label: 'Chat',
      sessionId: sourceTabId,
      mode: 'awake',
      initialPrompt: 'stale kickoff',
      teleportSessionId: 'stale-teleport'
    }
    seedLeaf(store, wtPath, {
      type: 'leaf',
      id: 'pane-source',
      tabs: [sourceTab],
      activeTabId: sourceTabId
    })

    const newPane = fsm.splitPane(wtPath, 'pane-source', 'horizontal')
    const cloned = newPane!.tabs[0]
    expect(cloned.initialPrompt).toBeUndefined()
    expect(cloned.teleportSessionId).toBeUndefined()
  })

  it('clones an agent source into a fresh shell tab (regression check)', () => {
    const { fsm, store } = buildFSM()
    const wtPath = '/wt/agent'
    seedLeaf(store, wtPath, {
      type: 'leaf',
      id: 'pane-agent',
      tabs: [
        {
          id: 'agent-1',
          type: 'agent',
          agentKind: 'claude',
          label: 'Claude',
          sessionId: 'cccccccc-cccc-4ccc-cccc-cccccccccccc'
        }
      ],
      activeTabId: 'agent-1'
    })

    const newPane = fsm.splitPane(wtPath, 'pane-agent', 'horizontal')
    const cloned = newPane!.tabs[0]
    expect(cloned.type).toBe('shell')
    expect(cloned.id).toMatch(/^shell-/)
  })

  it('clones a diff source by copying the source tab with a new diff-prefixed id', () => {
    const { fsm, store } = buildFSM()
    const wtPath = '/wt/diff'
    seedLeaf(store, wtPath, {
      type: 'leaf',
      id: 'pane-diff',
      tabs: [
        {
          id: 'diff-1',
          type: 'diff',
          label: 'src/foo.ts',
          filePath: 'src/foo.ts',
          staged: false
        }
      ],
      activeTabId: 'diff-1'
    })

    const newPane = fsm.splitPane(wtPath, 'pane-diff', 'horizontal')
    const cloned = newPane!.tabs[0]
    expect(cloned.type).toBe('diff')
    expect(cloned.id).toMatch(/^diff-/)
    expect(cloned.id).not.toBe('diff-1')
    expect(cloned.filePath).toBe('src/foo.ts')
  })

  it('wraps the source pane in a split node containing both children', () => {
    const { fsm, store } = buildFSM()
    const wtPath = '/wt/split'
    const sourceTabId = 'dddddddd-dddd-4ddd-dddd-dddddddddddd'
    seedLeaf(store, wtPath, {
      type: 'leaf',
      id: 'pane-source',
      tabs: [
        {
          id: sourceTabId,
          type: 'json-claude',
          label: 'Chat',
          sessionId: sourceTabId,
          mode: 'awake'
        }
      ],
      activeTabId: sourceTabId
    })

    fsm.splitPane(wtPath, 'pane-source', 'vertical')
    const tree = store.getSnapshot().state.terminals.panes[wtPath] as PaneNode
    expect(tree.type).toBe('split')
    if (tree.type === 'split') {
      expect(tree.direction).toBe('vertical')
      expect(tree.children).toHaveLength(2)
      expect(tree.children[0].id).toBe('pane-source')
    }
  })
})

describe('PanesFSM.restoreFromConfig', () => {
  it('hydrates persisted shell and json-claude tabs as asleep, agent tabs as awake', async () => {
    const { fsm, store } = buildFSM()
    const wtPath = '/wt/restore'
    await fsm.restoreFromConfig({
      _ignored: {
        [wtPath]: {
          type: 'leaf',
          id: 'pane-1',
          tabs: [
            { id: 'sh-1', type: 'shell', label: 'Shell' },
            { id: 'agent-1', type: 'agent', label: 'Claude', agentKind: 'claude' },
            {
              id: 'chat-1',
              type: 'json-claude',
              label: 'Chat',
              sessionId: 'chat-1'
            }
          ],
          activeTabId: 'sh-1'
        }
      }
    })
    fsm.ensureInitialized(wtPath)
    const tree = store.getSnapshot().state.terminals.panes[wtPath]
    expect(tree?.type).toBe('leaf')
    const leaf = tree as PaneLeaf
    const shellTab = leaf.tabs.find((t) => t.id === 'sh-1')
    const agentTab = leaf.tabs.find((t) => t.id === 'agent-1')
    const chatTab = leaf.tabs.find((t) => t.id === 'chat-1')
    expect(shellTab?.mode).toBe('asleep')
    expect(agentTab?.mode).toBeUndefined()
    expect(chatTab?.mode).toBe('asleep')
  })
})

describe('PanesFSM runner tabs', () => {
  const PREFIX = 'shell-runner-wt-dev-'

  it('openRunnerTab creates a shell tab with the command and prefixed id', () => {
    const { fsm, store } = buildFSM()
    const wtPath = '/wt/r1'
    seedLeaf(store, wtPath, {
      type: 'leaf',
      id: 'pane-1',
      tabs: [{ id: 'agent-1', type: 'agent', label: 'Claude' }],
      activeTabId: 'agent-1'
    })

    fsm.openRunnerTab(wtPath, PREFIX, 'Dev server', 'npm run dev', 'pane-1')

    const leaf = store.getSnapshot().state.terminals.panes[wtPath] as PaneLeaf
    const tab = leaf.tabs.find((t) => t.type === 'shell')
    expect(tab?.id.startsWith(PREFIX)).toBe(true)
    expect(tab?.command).toBe('npm run dev')
    expect(tab?.label).toBe('Dev server')
    expect(leaf.activeTabId).toBe(tab?.id)
  })

  it('cardinality 1 focuses the existing tab instead of spawning a duplicate', () => {
    const { fsm, store } = buildFSM()
    const wtPath = '/wt/r2'
    seedLeaf(store, wtPath, {
      type: 'leaf',
      id: 'pane-1',
      tabs: [
        { id: `${PREFIX}111`, type: 'shell', label: 'Dev server', command: 'npm run dev' },
        { id: 'sh-2', type: 'shell', label: 'Shell' }
      ],
      activeTabId: 'sh-2'
    })

    fsm.openRunnerTab(wtPath, PREFIX, 'Dev server', 'npm run dev', 'pane-1', 1)

    const leaf = store.getSnapshot().state.terminals.panes[wtPath] as PaneLeaf
    expect(leaf.tabs.filter((t) => t.id.startsWith(PREFIX))).toHaveLength(1)
    expect(leaf.activeTabId).toBe(`${PREFIX}111`)
  })

  it('unlimited cardinality (undefined) spawns a new instance each launch', () => {
    const { fsm, store } = buildFSM()
    const wtPath = '/wt/r2b'
    seedLeaf(store, wtPath, {
      type: 'leaf',
      id: 'pane-1',
      tabs: [{ id: `${PREFIX}111`, type: 'shell', label: 'Dev server', command: 'npm run dev' }],
      activeTabId: `${PREFIX}111`
    })

    fsm.openRunnerTab(wtPath, PREFIX, 'Dev server', 'npm run dev', 'pane-1')

    const leaf = store.getSnapshot().state.terminals.panes[wtPath] as PaneLeaf
    expect(leaf.tabs.filter((t) => t.id.startsWith(PREFIX))).toHaveLength(2)
  })

  it('cardinality N caps concurrent instances and focuses most recent at the cap', () => {
    const { fsm, store } = buildFSM()
    const wtPath = '/wt/r2c'
    seedLeaf(store, wtPath, {
      type: 'leaf',
      id: 'pane-1',
      tabs: [{ id: `${PREFIX}111`, type: 'shell', label: 'Dev', command: 'x' }],
      activeTabId: `${PREFIX}111`
    })

    // Under cap (1 < 2) → spawns a second.
    fsm.openRunnerTab(wtPath, PREFIX, 'Dev', 'x', 'pane-1', 2)
    let leaf = store.getSnapshot().state.terminals.panes[wtPath] as PaneLeaf
    expect(leaf.tabs.filter((t) => t.id.startsWith(PREFIX))).toHaveLength(2)
    const newest = leaf.tabs.filter((t) => t.id.startsWith(PREFIX)).map((t) => t.id).sort().at(-1)!

    // At cap (2 >= 2) → no new tab, focus the most-recent instance.
    fsm.openRunnerTab(wtPath, PREFIX, 'Dev', 'x', 'pane-1', 2)
    leaf = store.getSnapshot().state.terminals.panes[wtPath] as PaneLeaf
    expect(leaf.tabs.filter((t) => t.id.startsWith(PREFIX))).toHaveLength(2)
    expect(leaf.activeTabId).toBe(newest)
  })

  it('restartRunnerTab kills the PTY and swaps the id (remount → respawn)', () => {
    const store = new Store()
    const killed: string[] = []
    const fsm = new PanesFSM(store, {
      persist: () => {},
      getRepoRootForWorktree: () => undefined,
      getLatestClaudeSessionId: async () => null,
      killTabPty: (id) => killed.push(id)
    })
    const wtPath = '/wt/r3'
    seedLeaf(store, wtPath, {
      type: 'leaf',
      id: 'pane-1',
      tabs: [{ id: `${PREFIX}111`, type: 'shell', label: 'Dev server', command: 'npm run dev' }],
      activeTabId: `${PREFIX}111`
    })

    fsm.restartRunnerTab(wtPath, PREFIX)

    expect(killed).toEqual([`${PREFIX}111`])
    const leaf = store.getSnapshot().state.terminals.panes[wtPath] as PaneLeaf
    const tab = leaf.tabs.find((t) => t.type === 'shell')
    expect(tab?.id.startsWith(PREFIX)).toBe(true)
    expect(tab?.id).not.toBe(`${PREFIX}111`) // id swapped so XTerminal remounts
    expect(tab?.command).toBe('npm run dev') // command preserved
    expect(leaf.activeTabId).toBe(tab?.id)
  })

  it('restartRunnerTab is a no-op when the runner has no open tab', () => {
    const { fsm, store } = buildFSM()
    const wtPath = '/wt/r4'
    seedLeaf(store, wtPath, {
      type: 'leaf',
      id: 'pane-1',
      tabs: [{ id: 'sh-1', type: 'shell', label: 'Shell' }],
      activeTabId: 'sh-1'
    })
    const before = store.getSnapshot().state.terminals.panes[wtPath]
    fsm.restartRunnerTab(wtPath, PREFIX)
    expect(store.getSnapshot().state.terminals.panes[wtPath]).toBe(before)
  })
})
