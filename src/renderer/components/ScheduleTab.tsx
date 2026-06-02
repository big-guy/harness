import { useMemo, useState } from 'react'
import {
  CalendarClock,
  Plus,
  Pencil,
  Trash2,
  Check,
  X,
  GitBranch,
  FolderGit2,
  Repeat,
  Power,
  ArrowRight,
  Loader2
} from 'lucide-react'
import { useSchedules, useWorktrees } from '../store'
import { useBackend } from '../backend'
import { Tooltip } from './Tooltip'
import {
  SCHEDULE_REPEATS,
  categorizeSchedule,
  scheduleWorktreePath,
  type Schedule,
  type ScheduleCategory,
  type ScheduleRepeat,
  type ScheduleTarget
} from '../../shared/state/schedules'

const REPEAT_LABEL: Record<ScheduleRepeat, string> = {
  once: 'One time',
  daily: 'Daily',
  weekdays: 'Weekdays',
  weekly: 'Weekly',
  monthly: 'Monthly'
}

function repoLabel(repoRoot: string): string {
  return repoRoot.split('/').pop() || repoRoot
}

/** ISO → value for <input type="datetime-local"> in the local timezone. */
function toLocalInput(iso: string): string {
  const d = new Date(iso)
  if (!Number.isFinite(d.getTime())) return ''
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function fromLocalInput(local: string): string {
  const d = new Date(local)
  return Number.isFinite(d.getTime()) ? d.toISOString() : ''
}

function defaultAt(): string {
  // Next top of the hour, an hour from now.
  const d = new Date(Date.now() + 60 * 60 * 1000)
  d.setMinutes(0, 0, 0)
  return toLocalInput(d.toISOString())
}

function formatWhen(iso: string): string {
  const d = new Date(iso)
  if (!Number.isFinite(d.getTime())) return iso
  return d.toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  })
}

interface DraftState {
  id: string | null
  title: string
  /** datetime-local value (local tz). */
  at: string
  repeat: ScheduleRepeat
  prompt: string
  targetKind: 'repo' | 'worktree'
  repoRoot: string
  worktreePath: string
}

export function ScheduleTab({
  onSelectWorktree
}: {
  onSelectWorktree?: (path: string) => void
}): JSX.Element {
  const backend = useBackend()
  const { items } = useSchedules()
  const worktrees = useWorktrees()
  const repoRoots = worktrees.repoRoots
  const [draft, setDraft] = useState<DraftState | null>(null)
  const [saving, setSaving] = useState(false)

  const livePaths = useMemo(
    () => new Set(worktrees.list.map((w) => w.path)),
    [worktrees.list]
  )

  // Partition into the three lifecycle buckets. `now` is read once per render;
  // a 60s store tick (the runner's scan) re-renders us, so it stays fresh.
  const groups = useMemo(() => {
    const now = Date.now()
    const upcoming: Schedule[] = []
    const active: Schedule[] = []
    const past: Schedule[] = []
    for (const s of items) {
      const cat = categorizeSchedule(s, livePaths, now)
      if (cat === 'active') active.push(s)
      else if (cat === 'past') past.push(s)
      else upcoming.push(s)
    }
    const byAtAsc = (a: Schedule, b: Schedule): number =>
      Date.parse(a.at) - Date.parse(b.at)
    const byRunDesc = (a: Schedule, b: Schedule): number =>
      Date.parse(b.lastRunAt ?? b.at) - Date.parse(a.lastRunAt ?? a.at)
    upcoming.sort(byAtAsc)
    active.sort(byRunDesc)
    past.sort(byRunDesc)
    return { upcoming, active, past }
  }, [items, livePaths])

  const total = items.length

  const worktreesForRepo = useMemo(
    () =>
      worktrees.list.filter(
        (w) => !draft || draft.repoRoot === '' || w.repoRoot === draft.repoRoot
      ),
    [worktrees.list, draft]
  )

  function startAdd(): void {
    setDraft({
      id: null,
      title: '',
      at: defaultAt(),
      repeat: 'once',
      prompt: '',
      targetKind: 'repo',
      repoRoot: repoRoots[0] ?? '',
      worktreePath: ''
    })
  }

  function startEdit(s: Schedule): void {
    setDraft({
      id: s.id,
      title: s.title,
      at: toLocalInput(s.at),
      repeat: s.repeat,
      prompt: s.prompt,
      targetKind: s.target.kind,
      repoRoot: s.target.repoRoot,
      worktreePath: s.target.kind === 'worktree' ? s.target.worktreePath : ''
    })
  }

  function buildTarget(d: DraftState): ScheduleTarget | null {
    if (d.targetKind === 'worktree') {
      const wt = worktrees.list.find((w) => w.path === d.worktreePath)
      if (!wt) return null
      return { kind: 'worktree', worktreePath: wt.path, repoRoot: wt.repoRoot }
    }
    if (!d.repoRoot) return null
    return { kind: 'repo', repoRoot: d.repoRoot }
  }

  const canSave =
    !!draft &&
    draft.title.trim() !== '' &&
    draft.at !== '' &&
    buildTarget(draft) !== null

  async function save(): Promise<void> {
    if (!draft || !canSave) return
    const target = buildTarget(draft)
    const at = fromLocalInput(draft.at)
    if (!target || !at) return
    const schedule: Schedule = {
      id: draft.id ?? crypto.randomUUID(),
      title: draft.title.trim(),
      at,
      repeat: draft.repeat,
      prompt: draft.prompt,
      target,
      enabled: true,
      createdAt: new Date().toISOString()
    }
    setSaving(true)
    try {
      await backend.saveSchedule(schedule)
      setDraft(null)
    } finally {
      setSaving(false)
    }
  }

  async function toggleEnabled(s: Schedule): Promise<void> {
    await backend.saveSchedule({ ...s, enabled: !s.enabled })
  }

  async function remove(id: string): Promise<void> {
    await backend.removeSchedule(id)
    if (draft?.id === id) setDraft(null)
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      {/* Add schedule */}
      <button
        onClick={startAdd}
        className="group relative w-full flex items-center gap-2 px-3 py-2 text-dim hover:bg-panel-raised transition-colors cursor-pointer overflow-hidden border-b border-border shrink-0"
      >
        <span className="absolute left-0 top-0 bottom-0 w-0.5 brand-gradient-flow-bar opacity-0 group-hover:opacity-100 transition-opacity" />
        <Plus className="icon-sm shrink-0 text-dim group-hover:[stroke:url(#harness-add-gradient)] transition-colors" />
        <span className="text-sm font-medium brand-gradient-flow-text-hover">Add schedule</span>
      </button>

      {draft && (
        <ScheduleForm
          draft={draft}
          setDraft={setDraft}
          repoRoots={repoRoots}
          worktreesForRepo={worktreesForRepo}
          canSave={canSave}
          saving={saving}
          onSave={save}
          onCancel={() => setDraft(null)}
        />
      )}

      <div className="flex-1 overflow-y-auto">
        {total === 0 && !draft && (
          <div className="flex-1 flex items-center justify-center py-16">
            <div className="max-w-sm text-center px-6">
              <CalendarClock className="icon-xl mx-auto text-faint mb-3" />
              <div className="text-sm font-semibold text-fg-bright mb-1">No schedules yet</div>
              <div className="text-xs text-dim leading-relaxed">
                Schedule a prompt to run at a chosen time — once or on a repeat —
                against a repository or a specific worktree.
              </div>
            </div>
          </div>
        )}
        {(
          [
            ['Upcoming', groups.upcoming, 'upcoming'],
            ['Active', groups.active, 'active'],
            ['Past', groups.past, 'past']
          ] as const
        ).map(([label, list, cat]) =>
          list.length === 0 ? null : (
            <div key={cat}>
              <div className="px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-faint bg-panel/40 border-y border-border flex items-center gap-1.5">
                {cat === 'active' && <Loader2 className="icon-2xs animate-spin text-accent" />}
                <span>
                  {label} · {list.length}
                </span>
              </div>
              {list.map((s) => (
                <ScheduleRow
                  key={s.id}
                  schedule={s}
                  category={cat}
                  onEdit={() => startEdit(s)}
                  onToggle={() => void toggleEnabled(s)}
                  onRemove={() => void remove(s.id)}
                  onOpenWorktree={
                    onSelectWorktree
                      ? () => {
                          const wt = scheduleWorktreePath(s)
                          if (wt) onSelectWorktree(wt)
                        }
                      : undefined
                  }
                />
              ))}
            </div>
          )
        )}
      </div>
    </div>
  )
}

function ScheduleRow({
  schedule,
  category,
  onEdit,
  onToggle,
  onRemove,
  onOpenWorktree
}: {
  schedule: Schedule
  category: ScheduleCategory
  onEdit: () => void
  onToggle: () => void
  onRemove: () => void
  onOpenWorktree?: () => void
}): JSX.Element {
  const s = schedule
  const targetIcon =
    s.target.kind === 'worktree' ? (
      <GitBranch className="icon-2xs shrink-0" />
    ) : (
      <FolderGit2 className="icon-2xs shrink-0" />
    )
  const targetText =
    s.target.kind === 'worktree'
      ? s.target.worktreePath.split('/').pop() || s.target.worktreePath
      : repoLabel(s.target.repoRoot)
  // Upcoming rows lead with their next time; ran rows lead with when they ran.
  const when = category === 'past' ? s.lastRunAt ?? s.at : s.at
  const whenPrefix = category === 'past' ? 'Ran ' : category === 'active' ? 'Started ' : ''
  return (
    <div
      className={`group px-3 py-2 border-b border-border flex items-start gap-2 ${
        s.enabled || category !== 'upcoming' ? '' : 'opacity-50'
      }`}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-fg-bright truncate">{s.title}</span>
          {s.repeat !== 'once' && (
            <span className="flex items-center gap-0.5 text-xs text-faint shrink-0">
              <Repeat className="icon-2xs" />
              {REPEAT_LABEL[s.repeat]}
            </span>
          )}
        </div>
        <div className="mt-0.5 flex items-center gap-2 text-xs text-dim">
          <CalendarClock className="icon-2xs shrink-0" />
          <span>
            {whenPrefix}
            {formatWhen(when)}
          </span>
          <span className="text-faint">·</span>
          <span className="flex items-center gap-1 min-w-0">
            {targetIcon}
            <span className="truncate">{targetText}</span>
          </span>
        </div>
        {category === 'past' && s.lastSummary ? (
          <div className="mt-1 text-xs text-dim line-clamp-3 whitespace-pre-wrap border-l-2 border-border pl-2">
            {s.lastSummary}
          </div>
        ) : (
          s.prompt.trim() !== '' && (
            <div className="mt-1 text-xs text-faint line-clamp-2 whitespace-pre-wrap">
              {s.prompt}
            </div>
          )
        )}
      </div>
      <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
        {category === 'active' && onOpenWorktree && (
          <Tooltip label="Open worktree" side="left">
            <button
              onClick={onOpenWorktree}
              className="text-dim hover:text-fg hover:bg-surface rounded p-1 cursor-pointer transition-colors"
            >
              <ArrowRight className="icon-xs" />
            </button>
          </Tooltip>
        )}
        {category !== 'past' && (
          <Tooltip label={s.enabled ? 'Pause' : 'Resume'} side="left">
            <button
              onClick={onToggle}
              className={`rounded p-1 cursor-pointer transition-colors ${
                s.enabled ? 'text-dim hover:text-fg hover:bg-surface' : 'text-accent hover:bg-surface'
              }`}
            >
              <Power className="icon-xs" />
            </button>
          </Tooltip>
        )}
        {category !== 'past' && (
          <Tooltip label="Edit" side="left">
            <button
              onClick={onEdit}
              className="text-dim hover:text-fg hover:bg-surface rounded p-1 cursor-pointer transition-colors"
            >
              <Pencil className="icon-xs" />
            </button>
          </Tooltip>
        )}
        <Tooltip label="Delete" side="left">
          <button
            onClick={onRemove}
            className="text-dim hover:text-danger hover:bg-surface rounded p-1 cursor-pointer transition-colors"
          >
            <Trash2 className="icon-xs" />
          </button>
        </Tooltip>
      </div>
    </div>
  )
}

function ScheduleForm({
  draft,
  setDraft,
  repoRoots,
  worktreesForRepo,
  canSave,
  saving,
  onSave,
  onCancel
}: {
  draft: DraftState
  setDraft: (d: DraftState) => void
  repoRoots: string[]
  worktreesForRepo: { path: string; branch: string; repoRoot: string }[]
  canSave: boolean
  saving: boolean
  onSave: () => void
  onCancel: () => void
}): JSX.Element {
  const inputCls =
    'w-full bg-panel border border-border rounded px-2 py-1 text-sm text-fg-bright placeholder-faint outline-none focus:border-accent'
  const labelCls = 'text-xs font-semibold text-dim mb-1'
  return (
    <div className="px-3 py-3 border-b border-border bg-panel/40 shrink-0 space-y-3">
      <div>
        <div className={labelCls}>Title</div>
        <input
          autoFocus
          type="text"
          value={draft.title}
          onChange={(e) => setDraft({ ...draft, title: e.target.value })}
          placeholder="e.g. Nightly dependency update"
          className={inputCls}
        />
      </div>

      <div className="flex gap-2">
        <div className="flex-1">
          <div className={labelCls}>When</div>
          <input
            type="datetime-local"
            value={draft.at}
            onChange={(e) => setDraft({ ...draft, at: e.target.value })}
            className={inputCls}
          />
        </div>
        <div className="w-40">
          <div className={labelCls}>Repeat</div>
          <select
            value={draft.repeat}
            onChange={(e) => setDraft({ ...draft, repeat: e.target.value as ScheduleRepeat })}
            className={`${inputCls} cursor-pointer`}
          >
            {SCHEDULE_REPEATS.map((r) => (
              <option key={r} value={r}>
                {REPEAT_LABEL[r]}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <div className={labelCls}>Run against</div>
        <div className="flex gap-1 mb-2">
          {(['repo', 'worktree'] as const).map((kind) => (
            <button
              key={kind}
              onClick={() => setDraft({ ...draft, targetKind: kind })}
              className={`flex items-center gap-1.5 px-3 py-1 text-xs rounded cursor-pointer transition-colors ${
                draft.targetKind === kind
                  ? 'bg-accent text-app font-semibold'
                  : 'bg-panel text-dim hover:text-fg border border-border'
              }`}
            >
              {kind === 'repo' ? (
                <FolderGit2 className="icon-2xs" />
              ) : (
                <GitBranch className="icon-2xs" />
              )}
              {kind === 'repo' ? 'Repository' : 'Worktree'}
            </button>
          ))}
        </div>
        {draft.targetKind === 'repo' ? (
          <select
            value={draft.repoRoot}
            onChange={(e) => setDraft({ ...draft, repoRoot: e.target.value })}
            className={`${inputCls} cursor-pointer`}
          >
            {repoRoots.length === 0 && <option value="">No repositories</option>}
            {repoRoots.map((r) => (
              <option key={r} value={r}>
                {repoLabel(r)}
              </option>
            ))}
          </select>
        ) : (
          <select
            value={draft.worktreePath}
            onChange={(e) => setDraft({ ...draft, worktreePath: e.target.value })}
            className={`${inputCls} cursor-pointer`}
          >
            <option value="">Select a worktree…</option>
            {worktreesForRepo.map((w) => (
              <option key={w.path} value={w.path}>
                {repoLabel(w.repoRoot)} · {w.branch}
              </option>
            ))}
          </select>
        )}
        {draft.targetKind === 'worktree' && (
          <div className="mt-1 text-xs text-faint">
            Worktree schedules are removed when the worktree is deleted.
          </div>
        )}
      </div>

      <div>
        <div className={labelCls}>Prompt</div>
        <textarea
          value={draft.prompt}
          onChange={(e) => setDraft({ ...draft, prompt: e.target.value })}
          placeholder="What should the agent do when this fires?"
          rows={3}
          className={`${inputCls} resize-y font-mono`}
        />
      </div>

      <div className="flex items-center justify-end gap-2">
        <button
          onClick={onCancel}
          className="flex items-center gap-1 text-xs text-dim hover:text-fg px-3 py-1.5 rounded cursor-pointer"
        >
          <X className="icon-xs" />
          Cancel
        </button>
        <button
          onClick={onSave}
          disabled={!canSave || saving}
          className="flex items-center gap-1 text-xs bg-accent hover:opacity-90 text-app rounded px-3 py-1.5 font-semibold cursor-pointer disabled:opacity-40"
        >
          <Check className="icon-xs" />
          {draft.id ? 'Save' : 'Create'}
        </button>
      </div>
    </div>
  )
}
