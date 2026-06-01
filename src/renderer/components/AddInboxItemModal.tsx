import { useCallback, useEffect, useState } from 'react'
import { X, Loader2, ArrowLeft, FileText, FilePlus2, GitBranch } from 'lucide-react'
import { useBackend } from '../backend'
import type { IssueTemplate } from '../types'

interface RepoChoice {
  owner: string
  repo: string
}

interface AddInboxItemModalProps {
  /** Repositories the user can open an issue in — derived from the
   *  GitHub origins of the tracked repos (worktrees.originByRoot). */
  repos: RepoChoice[]
  onClose: () => void
  /** Called after an issue is successfully created. */
  onCreated?: () => void
}

type Step = 'repo' | 'template' | 'form'

/** Always offered alongside the repo's real templates so the user can
 *  open a plain issue even when a repo defines no templates. */
const BLANK_TEMPLATE: IssueTemplate = {
  name: 'Blank issue',
  title: '',
  about: 'Open an issue without a template',
  body: ''
}

/** Guides the user through opening a new GitHub issue: pick a repository,
 *  pick an issue template (or blank), fill out the title/body the template
 *  prefills, then create it via the API and open it in the browser. */
export function AddInboxItemModal({ repos, onClose, onCreated }: AddInboxItemModalProps): JSX.Element {
  const backend = useBackend()
  const singleRepo = repos.length === 1
  const [step, setStep] = useState<Step>(singleRepo ? 'template' : 'repo')
  const [repo, setRepo] = useState<RepoChoice | null>(singleRepo ? repos[0] : null)
  const [templates, setTemplates] = useState<IssueTemplate[] | null>(null)
  const [loadingTemplates, setLoadingTemplates] = useState(false)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadTemplates = useCallback(
    async (r: RepoChoice): Promise<void> => {
      setLoadingTemplates(true)
      setTemplates(null)
      try {
        const t = await backend.listIssueTemplates(r.owner, r.repo)
        setTemplates(t)
      } catch {
        setTemplates([])
      } finally {
        setLoadingTemplates(false)
      }
    },
    [backend]
  )

  // When there's exactly one repo we skip the repo step — load its
  // templates immediately on mount.
  useEffect(() => {
    if (singleRepo) void loadTemplates(repos[0])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const selectRepo = (r: RepoChoice): void => {
    setRepo(r)
    setStep('template')
    void loadTemplates(r)
  }

  const selectTemplate = (t: IssueTemplate): void => {
    setTitle(t.title || '')
    setBody(t.body || '')
    setError(null)
    setStep('form')
  }

  const goBack = (): void => {
    setError(null)
    if (step === 'form') setStep('template')
    else if (step === 'template' && !singleRepo) setStep('repo')
  }

  const submit = async (): Promise<void> => {
    if (!repo || !title.trim() || submitting) return
    setSubmitting(true)
    setError(null)
    try {
      const result = await backend.createIssue(repo.owner, repo.repo, {
        title: title.trim(),
        body
      })
      if (result.ok) {
        onCreated?.()
        onClose()
      } else {
        setError(result.error)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSubmitting(false)
    }
  }

  const canGoBack = step === 'form' || (step === 'template' && !singleRepo)
  const headerLabel =
    step === 'repo'
      ? 'Add item — choose a repository'
      : `New issue · ${repo?.owner}/${repo?.repo}`

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-app/80 backdrop-blur-sm">
      <div className="bg-panel border border-border rounded-xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden flex flex-col max-h-[85vh]">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border shrink-0">
          {canGoBack && (
            <button
              onClick={goBack}
              aria-label="Back"
              className="text-dim hover:text-fg cursor-pointer"
            >
              <ArrowLeft size={14} />
            </button>
          )}
          <span className="text-sm font-semibold text-fg-bright flex-1 truncate">{headerLabel}</span>
          <button onClick={onClose} aria-label="Close" className="text-dim hover:text-fg cursor-pointer">
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {step === 'repo' && (
            <div className="flex flex-col gap-1.5">
              {repos.length === 0 && (
                <div className="text-xs text-faint py-6 text-center">
                  No repositories with a GitHub remote are open.
                </div>
              )}
              {repos.map((r) => (
                <button
                  key={`${r.owner}/${r.repo}`}
                  onClick={() => selectRepo(r)}
                  className="flex items-center gap-2 w-full text-left px-3 py-2 rounded border border-border bg-panel-raised hover:border-border-strong hover:bg-surface text-sm text-fg-bright cursor-pointer transition-colors"
                >
                  <GitBranch size={14} className="text-faint shrink-0" />
                  <span className="font-mono truncate">
                    {r.owner}/{r.repo}
                  </span>
                </button>
              ))}
            </div>
          )}

          {step === 'template' && (
            <div className="flex flex-col gap-1.5">
              {loadingTemplates ? (
                <div className="flex items-center justify-center gap-2 py-8 text-xs text-faint">
                  <Loader2 size={14} className="animate-spin" />
                  Loading issue templates…
                </div>
              ) : (
                [BLANK_TEMPLATE, ...(templates ?? [])].map((t, i) => (
                  <button
                    key={`${t.name}-${i}`}
                    onClick={() => selectTemplate(t)}
                    className="flex items-start gap-2 w-full text-left px-3 py-2 rounded border border-border bg-panel-raised hover:border-border-strong hover:bg-surface cursor-pointer transition-colors"
                  >
                    {i === 0 ? (
                      <FilePlus2 size={14} className="text-faint shrink-0 mt-0.5" />
                    ) : (
                      <FileText size={14} className="text-accent shrink-0 mt-0.5" />
                    )}
                    <span className="min-w-0">
                      <span className="block text-sm text-fg-bright truncate">{t.name || 'Untitled template'}</span>
                      {t.about && <span className="block text-xs text-dim truncate">{t.about}</span>}
                    </span>
                  </button>
                ))
              )}
            </div>
          )}

          {step === 'form' && (
            <div className="flex flex-col gap-3">
              <label className="block">
                <span className="text-[11px] text-dim">Title</span>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Issue title"
                  autoFocus
                  className="mt-1 w-full bg-panel border border-border-strong rounded px-2 py-1.5 text-sm text-fg-bright placeholder-faint outline-none focus:border-accent"
                />
              </label>
              <label className="block">
                <span className="text-[11px] text-dim">Description</span>
                <textarea
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  placeholder="Describe the issue (Markdown supported)"
                  rows={12}
                  className="mt-1 w-full bg-panel border border-border-strong rounded px-2 py-1.5 text-xs text-fg-bright placeholder-faint outline-none focus:border-accent font-mono resize-y"
                />
              </label>
              {error && <div className="text-xs text-danger">{error}</div>}
            </div>
          )}
        </div>

        {step === 'form' && (
          <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-border shrink-0">
            <button
              onClick={onClose}
              className="px-3 py-1.5 rounded text-xs text-dim hover:text-fg cursor-pointer"
            >
              Cancel
            </button>
            <button
              onClick={() => void submit()}
              disabled={!title.trim() || submitting}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-semibold bg-accent text-app disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
            >
              {submitting && <Loader2 size={11} className="animate-spin" />}
              Create issue
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
