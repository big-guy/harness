import { useEffect, useMemo, useState } from 'react'
import {
  ArrowLeft,
  RefreshCw,
  Loader2,
  GitPullRequest,
  CircleDot,
  CircleCheck,
  CircleX,
  AlertCircle,
  ExternalLink,
  Settings as SettingsIcon,
  Search
} from 'lucide-react'
import { useInbox, useSettings } from '../store'
import type { InboxItem } from '../../shared/state/inbox'

interface InboxScreenProps {
  onClose: () => void
  onOpenSettings: () => void
}

type SortKey = 'updated' | 'created' | 'comments'

function formatRelative(iso: string): string {
  const t = new Date(iso).getTime()
  if (!Number.isFinite(t)) return ''
  const diff = Date.now() - t
  if (diff < 60_000) return 'just now'
  const m = Math.floor(diff / 60_000)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h`
  const d = Math.floor(h / 24)
  if (d < 30) return `${d}d`
  const mo = Math.floor(d / 30)
  return `${mo}mo`
}

function filterAndSort(items: InboxItem[], filter: string, sort: SortKey): InboxItem[] {
  const needle = filter.trim().toLowerCase()
  const filtered = needle
    ? items.filter((it) => {
        if (it.title.toLowerCase().includes(needle)) return true
        if (it.author && it.author.login.toLowerCase().includes(needle)) return true
        if (`${it.owner}/${it.repo}`.toLowerCase().includes(needle)) return true
        if (`#${it.number}`.includes(needle)) return true
        for (const l of it.labels) {
          if (l.name.toLowerCase().includes(needle)) return true
        }
        return false
      })
    : items
  const sorted = [...filtered]
  if (sort === 'updated') {
    sorted.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  } else if (sort === 'created') {
    sorted.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  } else if (sort === 'comments') {
    sorted.sort((a, b) => b.commentCount - a.commentCount)
  }
  return sorted
}

function stateColor(item: InboxItem): string {
  if (item.state === 'closed') return 'text-fg/40'
  if (item.kind === 'pr') return 'text-success'
  return 'text-accent'
}

function StateIcon({ item }: { item: InboxItem }): JSX.Element {
  if (item.kind === 'pr') {
    return <GitPullRequest size={14} className={stateColor(item)} />
  }
  if (item.state === 'closed') {
    return <CircleX size={14} className={stateColor(item)} />
  }
  return <CircleDot size={14} className={stateColor(item)} />
}

interface ItemRowProps {
  item: InboxItem
  expanded: boolean
  onToggle: () => void
}

function ItemRow({ item, expanded, onToggle }: ItemRowProps): JSX.Element {
  return (
    <div className="border-b border-border">
      <button
        onClick={onToggle}
        className="w-full text-left px-3 py-2 flex items-start gap-2 hover:bg-panel-raised/40 transition-colors cursor-pointer"
      >
        <span className="mt-0.5">
          <StateIcon item={item} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="text-xs text-faint shrink-0">
              {item.owner}/{item.repo}#{item.number}
            </span>
            <span className="text-sm text-fg-bright truncate">{item.title}</span>
          </div>
          <div className="flex items-center gap-2 mt-0.5 text-[11px] text-dim">
            {item.author && <span>{item.author.login}</span>}
            <span>updated {formatRelative(item.updatedAt)} ago</span>
            {item.commentCount > 0 && <span>· {item.commentCount} comments</span>}
            {item.milestone && (
              <span className="rounded-sm bg-surface text-fg px-1 text-[10px]">
                {item.milestone.title}
              </span>
            )}
            {item.labels.length > 0 && (
              <span className="flex items-center gap-1 truncate">
                {item.labels.slice(0, 4).map((l) => (
                  <span
                    key={l.name}
                    className="rounded-sm px-1 text-[10px]"
                    style={{
                      backgroundColor: `#${l.color}33`,
                      color: `#${l.color}`
                    }}
                  >
                    {l.name}
                  </span>
                ))}
              </span>
            )}
          </div>
        </div>
        <a
          href={item.url}
          target="_blank"
          rel="noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="text-faint hover:text-fg shrink-0"
        >
          <ExternalLink size={12} />
        </a>
      </button>
      {expanded && (
        <div className="px-3 pb-3 pt-1 border-t border-border bg-panel-raised/30">
          {item.bodyPreview ? (
            <div className="text-xs text-muted whitespace-pre-wrap line-clamp-6">
              {item.bodyPreview}
            </div>
          ) : (
            <div className="text-xs text-faint italic">No description.</div>
          )}
          {item.assignees.length > 0 && (
            <div className="text-xs text-dim mt-2">
              Assigned to {item.assignees.map((a) => a.login).join(', ')}
            </div>
          )}
          <div className="mt-3 flex items-center gap-2">
            <button
              disabled
              title="Coming soon"
              className="text-xs bg-surface text-dim rounded px-2 py-1 cursor-not-allowed opacity-60"
            >
              {item.kind === 'pr' ? 'Check out for review' : 'Start working on this'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export function InboxScreen({ onClose, onOpenSettings }: InboxScreenProps): JSX.Element {
  const inbox = useInbox()
  const settings = useSettings()
  const queries = settings.inboxQueries

  const [activeQueryId, setActiveQueryId] = useState<string | null>(
    queries[0]?.id ?? null
  )
  const [filter, setFilter] = useState('')
  const [sort, setSort] = useState<SortKey>('updated')
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})

  // Keep activeQueryId valid as the configured list changes.
  useEffect(() => {
    if (queries.length === 0) {
      setActiveQueryId(null)
      return
    }
    if (!activeQueryId || !queries.find((q) => q.id === activeQueryId)) {
      setActiveQueryId(queries[0].id)
    }
  }, [queries, activeQueryId])

  // Trigger a stale-refresh whenever the user opens the view.
  useEffect(() => {
    void window.api.refreshInboxAllIfStale()
  }, [])

  const activeQuery = queries.find((q) => q.id === activeQueryId) || null
  const rawItems = activeQueryId ? inbox.byQueryId[activeQueryId] || [] : []
  const totalCount = activeQueryId ? inbox.totalCount[activeQueryId] ?? 0 : 0
  const loading = activeQueryId ? !!inbox.loading[activeQueryId] : false
  const error = activeQueryId ? inbox.errors[activeQueryId] : null

  const items = useMemo(() => filterAndSort(rawItems, filter, sort), [rawItems, filter, sort])
  const truncated = totalCount > rawItems.length

  const handleRefresh = (): void => {
    if (!activeQueryId) return
    void window.api.refreshInboxOne(activeQueryId)
  }

  const itemKey = (it: InboxItem): string => `${it.kind}:${it.owner}/${it.repo}#${it.number}`

  return (
    <div className="flex-1 min-w-0 flex flex-col bg-app">
      {/* Title bar */}
      <div className="drag-region h-10 shrink-0 flex items-center px-3 border-b border-border">
        <button
          onClick={onClose}
          className="no-drag flex items-center gap-1 text-dim hover:text-fg text-xs cursor-pointer"
        >
          <ArrowLeft size={12} />
          <span>Back</span>
        </button>
        <span className="ml-3 text-xs font-semibold text-fg-bright">Inbox</span>
      </div>

      {queries.length === 0 ? (
        <EmptyState onOpenSettings={onOpenSettings} />
      ) : (
        <>
          {/* Query tabs */}
          <div className="px-3 pt-2 flex items-center gap-1 border-b border-border overflow-x-auto">
            {queries.map((q) => {
              const isActive = q.id === activeQueryId
              const count = inbox.byQueryId[q.id]?.length ?? 0
              const tabLoading = !!inbox.loading[q.id]
              return (
                <button
                  key={q.id}
                  onClick={() => setActiveQueryId(q.id)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-t cursor-pointer transition-colors ${
                    isActive
                      ? 'bg-panel text-fg-bright border-b-2 border-accent -mb-px'
                      : 'text-dim hover:text-fg hover:bg-panel/60'
                  }`}
                >
                  <span>{q.name}</span>
                  {tabLoading ? (
                    <Loader2 size={10} className="animate-spin text-faint" />
                  ) : (
                    count > 0 && <span className="text-faint">{count}</span>
                  )}
                </button>
              )
            })}
            <button
              onClick={onOpenSettings}
              title="Manage inbox queries"
              className="ml-auto text-faint hover:text-fg p-1 rounded cursor-pointer"
            >
              <SettingsIcon size={12} />
            </button>
          </div>

          {/* Controls */}
          <div className="px-3 py-2 flex items-center gap-2 border-b border-border shrink-0">
            <div className="relative flex-1">
              <Search size={11} className="absolute left-2 top-1/2 -translate-y-1/2 text-faint pointer-events-none" />
              <input
                type="text"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Filter loaded items by title, label, author"
                className="w-full bg-panel border border-border rounded pl-7 pr-2 py-1 text-xs text-fg-bright placeholder-faint outline-none focus:border-accent"
              />
            </div>
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as SortKey)}
              className="bg-panel border border-border rounded px-2 py-1 text-xs text-fg outline-none focus:border-accent cursor-pointer"
            >
              <option value="updated">Sort: updated</option>
              <option value="created">Sort: created</option>
              <option value="comments">Sort: comments</option>
            </select>
            <button
              onClick={handleRefresh}
              disabled={loading || !activeQueryId}
              title="Refresh this query"
              className="text-dim hover:text-fg hover:bg-surface rounded p-1 transition-colors cursor-pointer disabled:opacity-40"
            >
              {loading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
            </button>
          </div>

          {/* Status bar — query string + truncation banner */}
          {activeQuery && (
            <div className="px-3 py-1 text-[10px] text-faint border-b border-border shrink-0 truncate">
              <code className="text-dim">{activeQuery.query}</code>
            </div>
          )}
          {truncated && (
            <div className="px-3 py-1.5 text-[11px] text-warning bg-warning/5 border-b border-border shrink-0 flex items-center gap-1.5">
              <AlertCircle size={11} className="shrink-0" />
              <span>
                Showing {rawItems.length} most recently updated of {totalCount}.
                Refine your query to see the rest.
              </span>
            </div>
          )}
          {error && (
            <div className="px-3 py-1.5 text-[11px] text-danger bg-danger/5 border-b border-border shrink-0 flex items-center gap-1.5">
              <AlertCircle size={11} className="shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* List */}
          <div className="flex-1 overflow-y-auto">
            {items.length === 0 && !loading && !error && (
              <div className="px-4 py-8 text-center text-xs text-faint">
                {filter ? 'No items match the filter.' : 'No items match this query.'}
              </div>
            )}
            {items.map((it) => {
              const key = itemKey(it)
              return (
                <ItemRow
                  key={key}
                  item={it}
                  expanded={!!expanded[key]}
                  onToggle={() =>
                    setExpanded((prev) => ({ ...prev, [key]: !prev[key] }))
                  }
                />
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}

interface EmptyStateProps {
  onOpenSettings: () => void
}

function EmptyState({ onOpenSettings }: EmptyStateProps): JSX.Element {
  return (
    <div className="flex-1 flex items-center justify-center">
      <div className="max-w-sm text-center px-6">
        <CircleCheck size={28} className="mx-auto text-faint mb-3" />
        <div className="text-sm font-semibold text-fg-bright mb-1">
          No inbox queries yet
        </div>
        <div className="text-xs text-dim mb-4 leading-relaxed">
          Configure one or more GitHub search queries to populate your inbox.
          For example: <code className="text-fg">is:open is:pr review-requested:@me</code>.
        </div>
        <button
          onClick={onOpenSettings}
          className="text-xs bg-accent hover:opacity-90 text-app rounded px-3 py-1.5 font-semibold cursor-pointer"
        >
          Open Settings
        </button>
      </div>
    </div>
  )
}
