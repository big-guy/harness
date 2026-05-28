import { useEffect, useMemo, useState } from 'react'
import { RightPanel } from './RightPanel'
import { useCosts, usePanes, useWorktrees } from '../store'
import { useBackend } from '../backend'
import { getLeaves } from '../../shared/state/terminals'
import {
  totalForSession,
  addBreakdown,
  cloneBreakdown,
  emptyBreakdown,
  emptyTally,
  type ContentBreakdown,
  type ModelTally
} from '../../shared/state/costs'
import type { ClaudeAuthInfo } from '../../shared/cost-summary'

interface CostPanelProps {
  worktreePath: string | null
}

function formatCost(n: number): string {
  if (n === 0) return '$0.00'
  if (n < 0.01) return '<$0.01'
  if (n < 1) return `$${n.toFixed(2)}`
  return `$${n.toFixed(2)}`
}

function shortModel(model: string): string {
  return model.replace(/^claude-/, '')
}

interface Row {
  label: string
  cost: number
}

function Bar({
  row,
  max,
  total
}: {
  row: Row
  max: number
  total: number
}): JSX.Element {
  const pct = total > 0 ? (row.cost / total) * 100 : 0
  const width = max > 0 ? (row.cost / max) * 100 : 0
  return (
    <div className="flex items-center gap-2 text-xs leading-tight">
      <span className="text-faint truncate w-20 shrink-0">{row.label}</span>
      <div className="flex-1 h-1.5 bg-panel-raised/40 rounded-sm overflow-hidden">
        <div
          className="h-full bg-accent/70"
          style={{ width: `${width}%` }}
        />
      </div>
      <span className="text-faint tabular-nums w-10 text-right shrink-0">
        {pct >= 1 ? `${Math.round(pct)}%` : '<1%'}
      </span>
      <span className="text-text tabular-nums w-12 text-right shrink-0">
        {formatCost(row.cost)}
      </span>
    </div>
  )
}

function Section({
  title,
  rows,
  total
}: {
  title: string
  rows: Row[]
  total: number
}): JSX.Element | null {
  const nonZero = rows.filter((r) => r.cost > 0).sort((a, b) => b.cost - a.cost)
  if (nonZero.length === 0) return null
  const max = nonZero[0].cost
  return (
    <div className="flex flex-col gap-1">
      <div className="text-xs uppercase tracking-wide text-faint">{title}</div>
      {nonZero.map((r) => (
        <Bar key={r.label} row={r} max={max} total={total} />
      ))}
    </div>
  )
}

function describeAccount(auth: ClaudeAuthInfo): string | null {
  if (!auth.loggedIn) return null
  return auth.email || auth.organizationName || auth.accountUuid || null
}

export function CostPanel({ worktreePath }: CostPanelProps): JSX.Element | null {
  const backend = useBackend()
  const costs = useCosts()
  const panes = usePanes()
  const worktrees = useWorktrees()
  const repoRoot = useMemo(() => {
    if (!worktreePath) return null
    return worktrees.list.find((w) => w.path === worktreePath)?.repoRoot ?? null
  }, [worktreePath, worktrees.list])
  const [auth, setAuth] = useState<ClaudeAuthInfo | null>(null)
  useEffect(() => {
    let cancelled = false
    void backend
      .getClaudeAuthStatus(repoRoot ?? undefined)
      .then((info) => {
        if (!cancelled) setAuth(info)
      })
      .catch(() => {
        if (!cancelled) setAuth(null)
      })
    return () => {
      cancelled = true
    }
  }, [repoRoot])

  const { total, breakdown, currentModel, hasData } = useMemo(() => {
    const breakdown: ContentBreakdown = cloneBreakdown(emptyBreakdown)
    const total: ModelTally = { ...emptyTally }
    let currentModel: string | null = null
    let latestTs = -Infinity
    let hasData = false

    if (worktreePath) {
      const tree = panes[worktreePath]
      const terminalIds = new Set<string>()
      if (tree) {
        for (const leaf of getLeaves(tree)) {
          for (const tab of leaf.tabs) {
            if (tab.type === 'agent' || tab.type === 'json-claude') {
              terminalIds.add(tab.id)
            }
          }
        }
      }
      // Dedup by transcriptPath so a tab that was restarted with
      // --resume against the same jsonl doesn't double-count.
      const seenTranscripts = new Set<string>()
      for (const tid of terminalIds) {
        const usage = costs.byTerminal[tid]
        if (!usage || seenTranscripts.has(usage.transcriptPath)) continue
        seenTranscripts.add(usage.transcriptPath)
        hasData = true
        const sessionTotal = totalForSession(usage)
        total.messages += sessionTotal.messages
        total.input += sessionTotal.input
        total.output += sessionTotal.output
        total.cacheRead += sessionTotal.cacheRead
        total.cacheWrite += sessionTotal.cacheWrite
        total.cost += sessionTotal.cost
        addBreakdown(breakdown, usage.breakdown)
        if (usage.updatedAt > latestTs && usage.currentModel) {
          latestTs = usage.updatedAt
          currentModel = usage.currentModel
        }
      }
    }
    return { total, breakdown, currentModel, hasData }
  }, [worktreePath, costs, panes])

  if (!worktreePath) return null

  const outputRows: Row[] = [
    { label: 'text', cost: breakdown.text },
    { label: 'thinking', cost: breakdown.thinking },
    { label: 'tool_use', cost: breakdown.toolUse }
  ]
  const inputRows: Row[] = [
    { label: 'user prompt', cost: breakdown.userPrompt },
    { label: 'asst echo', cost: breakdown.assistantEcho },
    ...Object.entries(breakdown.toolResults).map(([name, cost]) => ({
      label: name,
      cost
    }))
  ]

  return (
    <RightPanel
      id="cost"
      title="Cost"
      defaultCollapsed
      onCollapsedChange={(c) => {
        backend.setCostsInterest(!c)
      }}
    >
      <div className="px-3 py-2 flex flex-col gap-3">
        {auth && (
          <div className="flex items-center justify-between gap-2 text-xs">
            <span className="text-faint shrink-0">Account</span>
            <span
              className="text-text truncate text-right"
              title={
                auth.loggedIn
                  ? [auth.email, auth.organizationName, auth.accountUuid]
                      .filter(Boolean)
                      .join(' · ')
                  : 'Not signed in to Claude'
              }
            >
              {auth.loggedIn ? (describeAccount(auth) ?? 'signed in') : 'not signed in'}
            </span>
          </div>
        )}
        {!hasData ? (
          <div className="text-xs text-faint italic">
            No usage yet. Tallies update after each Claude turn.
          </div>
        ) : (
          <>
            <div className="flex items-baseline justify-between gap-2">
              <span
                className="text-base font-medium text-text tabular-nums"
                title={`${total.messages} assistant messages`}
              >
                {formatCost(total.cost)}
              </span>
              {currentModel && (
                <span className="text-xs text-faint truncate">
                  {shortModel(currentModel)}
                </span>
              )}
            </div>
            <Section title="Output (produced)" rows={outputRows} total={total.cost} />
            <Section title="Input (context)" rows={inputRows} total={total.cost} />
            <div
              className="text-xs text-faint italic"
              title="Per-block token counts aren't in the Anthropic usage field. Category splits are estimated by char-length proportion within each turn. The top-line total is exact."
            >
              breakdown is estimated
            </div>
          </>
        )}
      </div>
    </RightPanel>
  )
}
