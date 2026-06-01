import { useCallback, useEffect, useMemo, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
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
  Search,
  Plus,
  Wrench,
  HardHat,
  ClipboardCheck,
  Check
} from 'lucide-react'
import { useInbox, useSettings, useWorktrees } from '../store'
import { getBackend, useBackend } from '../backend'
import { AddInboxItemModal } from './AddInboxItemModal'
import { setInboxDragData } from '../inbox-drag'
import type { InboxItem } from '../../shared/state/inbox'
import type { Worktree } from '../types'

interface InboxScreenProps {
  onClose: () => void
  onOpenSettings: () => void
  /** Switch to a worktree (pending id for in-flight creations, or a real
   *  worktree path for existing checkouts). The screen calls this after
   *  the user successfully kicks off a "create worktree" action. */
  onSelectWorktree: (idOrPath: string) => void
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

function stateColor(item: InboxItem, inMergeQueue: boolean): string {
  if (item.state === 'closed') return 'text-fg/40'
  if (item.kind === 'pr' && inMergeQueue) return 'text-purple-400'
  if (item.kind === 'pr') return 'text-success'
  return 'text-accent'
}

function StateIcon({
  item,
  inMergeQueue
}: {
  item: InboxItem
  inMergeQueue: boolean
}): JSX.Element {
  if (item.kind === 'pr') {
    return <GitPullRequest size={14} className={stateColor(item, inMergeQueue)} />
  }
  if (item.state === 'closed') {
    return <CircleX size={14} className={stateColor(item, inMergeQueue)} />
  }
  return <CircleDot size={14} className={stateColor(item, inMergeQueue)} />
}

/** Extract referenced issue/PR numbers from the body. Matches `#NNN` and
 *  `GH-NNN`; dedupes; excludes the PR's own number. */
function extractIssueRefs(body: string | null, selfNumber: number): number[] {
  if (!body) return []
  const re = /(?:#|\bGH-)(\d+)\b/g
  const seen = new Set<number>()
  let m: RegExpExecArray | null
  while ((m = re.exec(body)) !== null) {
    const n = parseInt(m[1], 10)
    if (!Number.isFinite(n) || n === selfNumber) continue
    seen.add(n)
  }
  return [...seen].sort((a, b) => a - b)
}

function UserBadge({
  user
}: {
  user: { login: string; avatarUrl: string }
}): JSX.Element {
  return (
    <span className="inline-flex items-center gap-1">
      {user.avatarUrl && (
        <img
          src={user.avatarUrl}
          alt=""
          loading="lazy"
          className="w-3.5 h-3.5 rounded-full shrink-0"
        />
      )}
      <span>{user.login}</span>
    </span>
  )
}

interface ItemRowProps {
  item: InboxItem
  expanded: boolean
  onToggle: () => void
  onCreateWorktree: () => void
  createWorktreePending: boolean
  createWorktreeError: string | null
  /** Existing worktree for this item, if any. When set, the action label
   *  switches from "Review this"/"Start work" to "Open existing worktree". */
  existingWorktree: Worktree | null
  inMergeQueue: boolean
  /** Called after the item is closed on GitHub so the list can refresh. */
  onAfterClose: () => void
}

const lookAtPrompt = (url: string): string => `Look at this ${url}`
const fixPrompt = (url: string): string => `Prepare a reproducer and propose a fix: ${url}`
const investigatePrompt = (url: string): string =>
  `Investigate this issue and propose a response: ${url}`

function ItemRow({
  item,
  expanded,
  onToggle,
  onCreateWorktree,
  createWorktreePending,
  createWorktreeError,
  existingWorktree,
  inMergeQueue,
  onAfterClose
}: ItemRowProps): JSX.Element {
  const backend = useBackend()
  const [comment, setComment] = useState('')
  const [commenting, setCommenting] = useState(false)
  const [commented, setCommented] = useState(false)
  const [commentError, setCommentError] = useState<string | null>(null)
  const [confirmClose, setConfirmClose] = useState(false)
  const [closing, setClosing] = useState(false)
  const [closed, setClosed] = useState(false)
  const [closeError, setCloseError] = useState<string | null>(null)

  const dragBase = {
    kind: item.kind,
    owner: item.owner,
    repo: item.repo,
    number: item.number,
    title: item.title,
    url: item.url
  }

  const submitComment = async (): Promise<void> => {
    const body = comment.trim()
    if (!body || commenting) return
    setCommenting(true)
    setCommentError(null)
    const r = await backend.createInboxComment(item.owner, item.repo, item.number, body)
    setCommenting(false)
    if (r.ok) {
      setComment('')
      setCommented(true)
    } else {
      setCommentError(r.error)
    }
  }

  const handleClose = async (): Promise<void> => {
    if (!confirmClose) {
      setConfirmClose(true)
      return
    }
    setClosing(true)
    setCloseError(null)
    const r = await backend.closeInboxItem(item.owner, item.repo, item.number, item.kind)
    setClosing(false)
    if (r.ok) {
      setClosed(true)
      onAfterClose()
    } else {
      setConfirmClose(false)
      setCloseError(r.error)
    }
  }

  return (
    <div className="border-b border-border">
      <div className="flex items-stretch">
        {/* Per-intent drag handles, stacked at the left. Each carries its own
            prompt: dropping onto a worktree inserts it; dropping onto "Add
            worktree" seeds a new worktree with it. */}
        <div className="flex flex-col items-center justify-center gap-1.5 pl-2 pr-1 shrink-0 text-faint">
          <button
            draggable
            onClick={(e) => e.stopPropagation()}
            onDragStart={(e) =>
              setInboxDragData(e, {
                ...dragBase,
                prompt: fixPrompt(item.url),
                worktreePrompt: fixPrompt(item.url)
              })
            }
            title="Fix this — drag onto a worktree (or “Add worktree”): prepare a reproducer and propose a fix"
            className="hover:text-fg cursor-grab active:cursor-grabbing"
          >
            <Wrench size={12} />
          </button>
          <button
            draggable
            onClick={(e) => e.stopPropagation()}
            onDragStart={(e) =>
              setInboxDragData(e, {
                ...dragBase,
                prompt: investigatePrompt(item.url),
                worktreePrompt: investigatePrompt(item.url)
              })
            }
            title="Investigate this — drag onto a worktree (or “Add worktree”): investigate this issue and propose a response"
            className="hover:text-fg cursor-grab active:cursor-grabbing"
          >
            <Search size={12} />
          </button>
        </div>

        <button
          draggable
          onDragStart={(e) => setInboxDragData(e, { ...dragBase, prompt: lookAtPrompt(item.url) })}
          onClick={onToggle}
          title="Drag onto a worktree to reference it, or onto “Add worktree” to start one"
          className="min-w-0 flex-1 text-left px-3 py-2 flex items-start gap-2 hover:bg-panel-raised/40 transition-colors cursor-pointer"
        >
          <span className="mt-0.5">
            <StateIcon item={item} inMergeQueue={inMergeQueue} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="text-xs text-faint shrink-0">
                {item.owner}/{item.repo}#{item.number}
              </span>
              <span className="text-sm text-fg-bright truncate">{item.title}</span>
            </div>
            <div className="flex items-center gap-2 mt-0.5 text-[11px] text-dim">
              {item.author && <UserBadge user={item.author} />}
              <span>updated {formatRelative(item.updatedAt)} ago</span>
              {item.commentCount > 0 && <span>· {item.commentCount} comments</span>}
              {item.milestone && (
                <span className="rounded-sm bg-surface text-fg px-1 text-[10px]">
                  {item.milestone.title}
                </span>
              )}
              {existingWorktree && (
                <span className="rounded-sm bg-accent/15 text-accent px-1 text-[10px]">
                  in worktree
                </span>
              )}
              {inMergeQueue && (
                <span className="rounded-sm bg-purple-400/15 text-purple-400 px-1 text-[10px]">
                  queued
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
            draggable={false}
            onClick={(e) => e.stopPropagation()}
            className="text-faint hover:text-fg shrink-0"
          >
            <ExternalLink size={12} />
          </a>
        </button>
      </div>
      {expanded && (
        <div className="px-3 pb-3 pt-1 border-t border-border bg-panel-raised/30">
          {item.kind === 'pr' && (() => {
            const refs = extractIssueRefs(item.bodyPreview, item.number)
            if (refs.length === 0) return null
            return (
              <div className="text-xs text-dim mb-2 flex items-center gap-1.5 flex-wrap">
                <span>References:</span>
                {refs.map((n) => (
                  <button
                    key={n}
                    onClick={() =>
                      getBackend().openExternal(
                        `https://github.com/${item.owner}/${item.repo}/issues/${n}`
                      )
                    }
                    className="rounded-sm bg-surface hover:bg-surface-hover text-fg px-1 text-[10px] cursor-pointer"
                  >
                    #{n}
                  </button>
                ))}
              </div>
            )
          })()}
          {item.bodyPreview ? (
            <div className="markdown text-xs text-muted max-h-72 overflow-y-auto pr-1">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {item.bodyPreview}
              </ReactMarkdown>
            </div>
          ) : (
            <div className="text-xs text-faint italic">No description.</div>
          )}
          {item.assignees.length > 0 && (
            <div className="text-xs text-dim mt-2 flex items-center gap-1.5 flex-wrap">
              <span>Assigned to</span>
              {item.assignees.map((a) => (
                <UserBadge key={a.login} user={a} />
              ))}
            </div>
          )}
          <div className="mt-3 flex items-center gap-2 flex-wrap">
            <button
              onClick={onCreateWorktree}
              disabled={createWorktreePending}
              className="text-xs bg-accent text-app rounded px-2 py-1 font-semibold disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer flex items-center gap-1.5"
            >
              {createWorktreePending ? (
                <Loader2 size={11} className="animate-spin" />
              ) : existingWorktree ? null : item.kind === 'pr' ? (
                <ClipboardCheck size={11} />
              ) : (
                <HardHat size={11} />
              )}
              <span>
                {existingWorktree
                  ? 'Open existing worktree'
                  : item.kind === 'pr'
                    ? 'Review this'
                    : 'Start work'}
              </span>
            </button>
            {closed ? (
              <span className="text-xs text-success flex items-center gap-1">
                <Check size={11} /> Closed
              </span>
            ) : (
              <button
                onClick={() => void handleClose()}
                disabled={closing}
                className={`text-xs rounded px-2 py-1 cursor-pointer flex items-center gap-1.5 transition-colors disabled:opacity-50 ${
                  confirmClose
                    ? 'bg-danger/20 text-danger border border-danger/50'
                    : 'text-dim hover:text-fg border border-border'
                }`}
              >
                {closing && <Loader2 size={11} className="animate-spin" />}
                {confirmClose ? 'Confirm close' : 'Close'}
              </button>
            )}
            {existingWorktree && (
              <span className="text-[11px] text-faint truncate" title={existingWorktree.path}>
                {existingWorktree.branch}
              </span>
            )}
          </div>
          {createWorktreeError && (
            <div className="text-xs text-danger mt-1">{createWorktreeError}</div>
          )}
          {closeError && <div className="text-xs text-danger mt-1">{closeError}</div>}

          {/* Comment composer */}
          <div className="mt-3">
            <textarea
              value={comment}
              onChange={(e) => {
                setComment(e.target.value)
                setCommented(false)
                setCommentError(null)
              }}
              placeholder="Add a comment…"
              rows={2}
              className="w-full bg-panel border border-border-strong rounded px-2 py-1.5 text-xs text-fg-bright placeholder-faint outline-none focus:border-accent resize-y"
            />
            <div className="mt-1 flex items-center gap-2">
              <button
                onClick={() => void submitComment()}
                disabled={!comment.trim() || commenting}
                className="text-xs bg-surface hover:bg-surface-hover rounded px-2 py-1 text-fg-bright disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer flex items-center gap-1.5"
              >
                {commenting && <Loader2 size={11} className="animate-spin" />}
                Comment
              </button>
              {commented && (
                <span className="text-xs text-success flex items-center gap-1">
                  <Check size={11} /> Posted
                </span>
              )}
              {commentError && <span className="text-xs text-danger">{commentError}</span>}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export function InboxScreen({
  onClose,
  onOpenSettings,
  onSelectWorktree
}: InboxScreenProps): JSX.Element {
  const inbox = useInbox()
  const settings = useSettings()
  const worktrees = useWorktrees()
  const backend = useBackend()
  const queries = settings.inboxQueries
  const prPrefix = settings.inboxPRBranchPrefix
  const issuePrefix = settings.inboxIssueBranchPrefix

  /** Index worktrees by `<owner>/<repo>` so per-row lookup is O(1).
   *  Same-repo worktrees with different branches all live in the same
   *  bucket; the row scans the bucket for a match. */
  const worktreesByOwnerRepo = useMemo(() => {
    const map = new Map<string, Worktree[]>()
    for (const wt of worktrees.list) {
      const origin = worktrees.originByRoot[wt.repoRoot]
      if (!origin) continue
      const key = `${origin.owner.toLowerCase()}/${origin.repo.toLowerCase()}`
      const list = map.get(key)
      if (list) list.push(wt)
      else map.set(key, [wt])
    }
    return map
  }, [worktrees.list, worktrees.originByRoot])

  const findExistingWorktree = useCallback(
    (item: InboxItem): Worktree | null => {
      const bucket = worktreesByOwnerRepo.get(
        `${item.owner.toLowerCase()}/${item.repo.toLowerCase()}`
      )
      if (!bucket) return null
      if (item.kind === 'pr') {
        const wanted = `${prPrefix}${item.number}`
        return bucket.find((w) => w.branch === wanted) ?? null
      }
      // Issues: branch starts with `${issuePrefix}${n}-` or equals `${issuePrefix}${n}`.
      const wantedExact = `${issuePrefix}${item.number}`
      const wantedPrefix = `${issuePrefix}${item.number}-`
      return (
        bucket.find((w) => w.branch === wantedExact || w.branch.startsWith(wantedPrefix)) ??
        null
      )
    },
    [worktreesByOwnerRepo, prPrefix, issuePrefix]
  )

  // Unique GitHub repositories (owner/repo) across the tracked repos, for
  // the "Add item" flow. Deduped + sorted for a stable picker order.
  const availableRepos = useMemo(() => {
    const seen = new Map<string, { owner: string; repo: string }>()
    for (const origin of Object.values(worktrees.originByRoot)) {
      if (!origin?.owner || !origin?.repo) continue
      const key = `${origin.owner.toLowerCase()}/${origin.repo.toLowerCase()}`
      if (!seen.has(key)) seen.set(key, { owner: origin.owner, repo: origin.repo })
    }
    return [...seen.values()].sort((a, b) =>
      `${a.owner}/${a.repo}`.localeCompare(`${b.owner}/${b.repo}`)
    )
  }, [worktrees.originByRoot])

  const [showAddItem, setShowAddItem] = useState(false)
  const [activeQueryId, setActiveQueryId] = useState<string | null>(
    queries[0]?.id ?? null
  )
  const [filter, setFilter] = useState('')
  const [sort, setSort] = useState<SortKey>('updated')
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  /** itemKey → in-flight; cleared on success or surface as an error. */
  const [creating, setCreating] = useState<Record<string, boolean>>({})
  const [createError, setCreateError] = useState<Record<string, string>>({})

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
    void backend.refreshInboxAllIfStale()
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
    void backend.refreshInboxOne(activeQueryId)
  }

  const itemKey = (it: InboxItem): string => `${it.kind}:${it.owner}/${it.repo}#${it.number}`

  const handleRowAction = async (it: InboxItem): Promise<void> => {
    const existing = findExistingWorktree(it)
    if (existing) {
      onClose()
      onSelectWorktree(existing.path)
      return
    }
    return handleCreateWorktree(it)
  }

  const handleCreateWorktree = async (it: InboxItem): Promise<void> => {
    const key = itemKey(it)
    setCreating((prev) => ({ ...prev, [key]: true }))
    setCreateError((prev) => {
      const { [key]: _, ...rest } = prev
      return rest
    })
    try {
      const result = await backend.createInboxWorktree({
        kind: it.kind,
        owner: it.owner,
        repo: it.repo,
        number: it.number,
        title: it.title
      })
      onClose()
      if (result.kind === 'pending') {
        onSelectWorktree(result.pendingId)
      } else {
        onSelectWorktree(result.worktreePath)
      }
    } catch (err) {
      setCreateError((prev) => ({
        ...prev,
        [key]: err instanceof Error ? err.message : String(err)
      }))
    } finally {
      setCreating((prev) => {
        const { [key]: _, ...rest } = prev
        return rest
      })
    }
  }

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

      {/* Add item — opens a new GitHub issue in one of the tracked repos.
          Styled to match the sidebar's "Add worktree" affordance. */}
      <button
        onClick={() => setShowAddItem(true)}
        className="group relative w-full flex items-center gap-2 px-3 py-2 text-dim hover:bg-panel-raised transition-colors cursor-pointer overflow-hidden border-b border-border shrink-0"
      >
        <span className="absolute left-0 top-0 bottom-0 w-0.5 brand-gradient-flow-bar opacity-0 group-hover:opacity-100 transition-opacity" />
        <Plus className="icon-sm shrink-0 text-dim group-hover:[stroke:url(#harness-add-gradient)] transition-colors" />
        <span className="text-sm font-medium brand-gradient-flow-text-hover">Add item</span>
      </button>

      {showAddItem && (
        <AddInboxItemModal
          repos={availableRepos}
          onClose={() => setShowAddItem(false)}
          onCreated={() => void backend.refreshInboxAllIfStale()}
        />
      )}

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
                  onCreateWorktree={() => void handleRowAction(it)}
                  createWorktreePending={!!creating[key]}
                  createWorktreeError={createError[key] ?? null}
                  existingWorktree={findExistingWorktree(it)}
                  inMergeQueue={
                    it.kind === 'pr' && !!inbox.mergeQueueByKey[`pr:${it.owner}/${it.repo}#${it.number}`]
                  }
                  onAfterClose={handleRefresh}
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
