import { useEffect } from 'react'

interface ConfirmCloseTabModalProps {
  /** Tab label, shown so the user knows which tab they're about to kill. */
  tabLabel: string
  /** Why the tab is considered busy, e.g. "still working" / "running a
   * process" — completes the sentence "<label> is <reason>." */
  reason: string
  onConfirm: () => void
  onCancel: () => void
}

/**
 * Guard shown when ⌘W (or a tab's × button) would close a tab that's still
 * running — an agent mid-turn or a shell with a live process. Catches the
 * common ⌘W-meant-for-⌘Q fat-finger from killing work by accident. Esc /
 * backdrop cancel; Enter confirms the close.
 */
export function ConfirmCloseTabModal({
  tabLabel,
  reason,
  onConfirm,
  onCancel
}: ConfirmCloseTabModalProps): JSX.Element {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onCancel()
      } else if (e.key === 'Enter') {
        e.preventDefault()
        onConfirm()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onConfirm, onCancel])

  return (
    <div
      className="fixed inset-0 z-[70] flex items-start justify-center pt-[15vh] bg-black/40"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-md bg-surface rounded-xl shadow-2xl border border-border overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-3.5 border-b border-border">
          <h2 className="text-sm font-semibold text-fg-bright">Close this tab?</h2>
        </div>
        <div className="px-5 py-4 text-sm text-fg">
          <span className="font-medium text-fg-bright">{tabLabel}</span> is {reason}.
          Closing the tab will stop it.
        </div>
        <div className="px-5 py-3 border-t border-border flex items-center justify-end gap-2">
          <button
            onClick={onCancel}
            className="px-3 py-1.5 text-xs text-dim hover:text-fg cursor-pointer transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="px-4 py-1.5 text-xs font-medium rounded bg-accent/20 hover:bg-accent/30 text-fg-bright border border-accent/40 cursor-pointer transition-colors"
          >
            Close tab
          </button>
        </div>
      </div>
    </div>
  )
}
