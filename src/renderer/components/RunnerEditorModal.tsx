import { useCallback, useState } from 'react'
import { X, Wrench, Plus, Trash2, Pencil } from 'lucide-react'
import { useBackend } from '../backend'
import { resolveLucideIcon } from '../lucide-icon'
import type { RunnerItem } from '../types'

interface RunnerEditorModalProps {
  isOpen: boolean
  onClose: () => void
  /** Repo whose .harness.json the user runners are persisted to. Empty when
   *  the worktree isn't resolvable — the modal then renders a hint instead of
   *  a form, since there's nowhere to save. */
  repoRoot: string
  /** Current user runners for the repo (from .harness.json). */
  runners: readonly RunnerItem[]
}

interface DraftState {
  name: string
  command: string
  description: string
  icon: string
  cardinality: string
}

const EMPTY_DRAFT: DraftState = {
  name: '',
  command: '',
  description: '',
  icon: '',
  cardinality: ''
}

/** Modal for managing this repo's user-defined Toolbox runners. Opened by
 *  shift-clicking the Toolbox button. Runners edited here are written to the
 *  repo's .harness.json and shown (below a divider, under the agent-registered
 *  ones) in every worktree's Toolbox dropdown. */
export function RunnerEditorModal({
  isOpen,
  onClose,
  repoRoot,
  runners
}: RunnerEditorModalProps): JSX.Element | null {
  const backend = useBackend()
  const [draft, setDraft] = useState<DraftState>(EMPTY_DRAFT)
  // Name of the runner currently being edited (case-insensitive upsert key),
  // or null when adding a fresh one. Used to highlight the row + label the
  // submit button.
  const [editingName, setEditingName] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const resetForm = useCallback(() => {
    setDraft(EMPTY_DRAFT)
    setEditingName(null)
    setError(null)
  }, [])

  const handleClose = useCallback(() => {
    resetForm()
    onClose()
  }, [resetForm, onClose])

  const persist = useCallback(
    (next: RunnerItem[]) => {
      void backend.setRepoConfig(repoRoot, { runners: next })
    },
    [backend, repoRoot]
  )

  const handleSubmit = useCallback(() => {
    const name = draft.name.trim()
    const command = draft.command.trim()
    if (!name) {
      setError('Name is required.')
      return
    }
    if (!command) {
      setError('Command is required.')
      return
    }
    const icon = draft.icon.trim()
    const cardinalityNum = parseInt(draft.cardinality, 10)
    const cardinality =
      Number.isInteger(cardinalityNum) && cardinalityNum >= 1 ? cardinalityNum : undefined
    const item: RunnerItem = {
      name,
      command,
      description: draft.description.trim(),
      ...(icon ? { icon } : {}),
      ...(cardinality != null ? { cardinality } : {})
    }
    // Upsert by case-insensitive name. When editing a renamed entry, drop the
    // old key too so the rename doesn't leave a duplicate behind.
    const oldKey = (editingName ?? name).toLowerCase()
    const newKey = name.toLowerCase()
    const kept = runners.filter(
      (r) => r.name.toLowerCase() !== oldKey && r.name.toLowerCase() !== newKey
    )
    persist([...kept, item])
    resetForm()
  }, [draft, editingName, runners, persist, resetForm])

  const handleEdit = useCallback((runner: RunnerItem) => {
    setEditingName(runner.name)
    setError(null)
    setDraft({
      name: runner.name,
      command: runner.command,
      description: runner.description ?? '',
      icon: runner.icon ?? '',
      cardinality: runner.cardinality != null ? String(runner.cardinality) : ''
    })
  }, [])

  const handleDelete = useCallback(
    (name: string) => {
      const next = runners.filter((r) => r.name.toLowerCase() !== name.toLowerCase())
      persist(next)
      if (editingName && editingName.toLowerCase() === name.toLowerCase()) resetForm()
    },
    [runners, persist, editingName, resetForm]
  )

  if (!isOpen) return null

  const DraftIcon = resolveLucideIcon(draft.icon.trim())

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-app/80 backdrop-blur-sm">
      <div className="bg-panel border border-border rounded-xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden flex flex-col max-h-[85vh]">
        <div className="flex items-center justify-between px-5 py-3 border-b border-border shrink-0">
          <div className="flex items-center gap-2">
            <Wrench className="icon-sm text-accent" />
            <h2 className="text-sm font-semibold text-fg-bright">Your runners</h2>
          </div>
          <button
            onClick={handleClose}
            className="text-dim hover:text-fg transition-colors cursor-pointer"
            aria-label="Close"
          >
            <X className="icon-sm" />
          </button>
        </div>

        {!repoRoot ? (
          <div className="px-5 py-6 text-xs text-dim">
            This worktree isn’t associated with a known repo, so there’s nowhere
            to save runners.
          </div>
        ) : (
          <div className="px-5 py-4 space-y-4 overflow-y-auto">
            <p className="text-xs text-dim leading-relaxed">
              Runners you define here are saved to this repo’s{' '}
              <code className="bg-app/40 px-1 rounded text-xs">.harness.json</code>{' '}
              and appear in the Toolbox dropdown of every worktree.
            </p>

            {runners.length > 0 && (
              <div className="space-y-1">
                {runners.map((runner) => {
                  const Icon = resolveLucideIcon(runner.icon)
                  const isEditing =
                    editingName != null &&
                    editingName.toLowerCase() === runner.name.toLowerCase()
                  return (
                    <div
                      key={runner.name}
                      className={`flex items-center gap-2 rounded px-2 py-1.5 ${
                        isEditing ? 'bg-accent/10' : 'bg-app/40'
                      }`}
                    >
                      {Icon && <Icon className="icon-sm shrink-0 text-faint" />}
                      <div className="min-w-0 flex-1">
                        <div className="text-xs text-fg-bright truncate">{runner.name}</div>
                        <div className="text-xs text-faint font-mono truncate">
                          {runner.command}
                        </div>
                      </div>
                      <button
                        onClick={() => handleEdit(runner)}
                        title={`Edit "${runner.name}"`}
                        aria-label={`Edit ${runner.name}`}
                        className="shrink-0 p-1 text-faint hover:text-fg cursor-pointer"
                      >
                        <Pencil className="icon-sm" />
                      </button>
                      <button
                        onClick={() => handleDelete(runner.name)}
                        title={`Delete "${runner.name}"`}
                        aria-label={`Delete ${runner.name}`}
                        className="shrink-0 p-1 text-faint hover:text-danger cursor-pointer"
                      >
                        <Trash2 className="icon-sm" />
                      </button>
                    </div>
                  )
                })}
              </div>
            )}

            <div className="border-t border-border pt-4 space-y-3">
              <div className="text-xs font-medium text-dim uppercase tracking-wider">
                {editingName ? `Edit "${editingName}"` : 'Add a runner'}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-xs text-dim">Name</label>
                  <input
                    value={draft.name}
                    onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                    placeholder="Dev server"
                    autoFocus
                    className="w-full bg-app/40 border border-border rounded px-2.5 py-1.5 text-xs text-fg-bright placeholder:text-faint focus:outline-none focus:border-accent"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs text-dim">
                    Icon <span className="text-faint">(Lucide name, optional)</span>
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      value={draft.icon}
                      onChange={(e) => setDraft((d) => ({ ...d, icon: e.target.value }))}
                      placeholder="Play"
                      className="w-full bg-app/40 border border-border rounded px-2.5 py-1.5 text-xs text-fg-bright placeholder:text-faint focus:outline-none focus:border-accent"
                    />
                    {DraftIcon && <DraftIcon className="icon-sm shrink-0 text-faint" />}
                  </div>
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs text-dim">Command</label>
                <input
                  value={draft.command}
                  onChange={(e) => setDraft((d) => ({ ...d, command: e.target.value }))}
                  placeholder="npm run dev"
                  spellCheck={false}
                  className="w-full bg-app/40 border border-border rounded px-2.5 py-1.5 text-xs font-mono text-fg-bright placeholder:text-faint focus:outline-none focus:border-accent"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-xs text-dim">
                    Description <span className="text-faint">(optional)</span>
                  </label>
                  <input
                    value={draft.description}
                    onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
                    placeholder="Shown as the tooltip"
                    className="w-full bg-app/40 border border-border rounded px-2.5 py-1.5 text-xs text-fg-bright placeholder:text-faint focus:outline-none focus:border-accent"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs text-dim">
                    Max instances <span className="text-faint">(optional)</span>
                  </label>
                  <input
                    value={draft.cardinality}
                    onChange={(e) => setDraft((d) => ({ ...d, cardinality: e.target.value }))}
                    placeholder="unlimited"
                    inputMode="numeric"
                    className="w-full bg-app/40 border border-border rounded px-2.5 py-1.5 text-xs text-fg-bright placeholder:text-faint focus:outline-none focus:border-accent"
                  />
                </div>
              </div>

              {error && <div className="text-xs text-danger">{error}</div>}

              <div className="flex items-center justify-end gap-2">
                {editingName && (
                  <button
                    onClick={resetForm}
                    className="px-3 py-1.5 text-xs text-dim hover:text-fg cursor-pointer transition-colors"
                  >
                    Cancel edit
                  </button>
                )}
                <button
                  onClick={handleSubmit}
                  disabled={!draft.name.trim() || !draft.command.trim()}
                  className="px-4 py-1.5 text-xs font-medium rounded bg-accent/20 hover:bg-accent/30 text-fg-bright border border-accent/40 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer transition-colors flex items-center gap-1.5"
                >
                  <Plus className="icon-xs" />
                  {editingName ? 'Save changes' : 'Add runner'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
