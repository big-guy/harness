import { PanelRightOpen, Code2, FolderOpen } from 'lucide-react'
import { Tooltip } from './Tooltip'

interface CollapsedRightPanelProps {
  onExpand: () => void
  /** Active worktree path — used by the Open-in-editor and Reveal-in-
   *  Finder buttons. When null, both buttons are hidden (nothing to act
   *  on). */
  activeWorktreePath: string | null
  /** True when the active backend is local, so Reveal in Finder is
   *  actionable. Hidden on remote backends. */
  isLocalBackend: boolean
  onOpenInEditor: (worktreePath: string) => void
  onRevealInFinder: (worktreePath: string) => void
}

function btnClass(): string {
  return 'rounded p-1.5 transition-colors cursor-pointer text-dim hover:text-fg hover:bg-surface'
}

function Divider(): JSX.Element {
  return <div className="w-6 h-px bg-border my-1 shrink-0" />
}

export function CollapsedRightPanel({
  onExpand,
  activeWorktreePath,
  isLocalBackend,
  onOpenInEditor,
  onRevealInFinder
}: CollapsedRightPanelProps): JSX.Element {
  return (
    <div className="shrink-0 w-12 bg-panel border-l border-border flex flex-col items-center h-full">
      {/* Drag region at the top so the row aligns with the workspace's
          top bar height and the user can still drag the window from
          this column. */}
      <div className="drag-region h-10 w-full shrink-0" />

      <div className="flex flex-col items-center gap-0.5 py-1 shrink-0">
        <Tooltip label="Expand sidebar" action="toggleRightColumn" side="left">
          <button onClick={onExpand} className={btnClass()}>
            <PanelRightOpen className="w-3.5 h-3.5" />
          </button>
        </Tooltip>
      </div>

      <Divider />

      {activeWorktreePath && (
        <div className="flex flex-col items-center gap-0.5 py-1 shrink-0">
          <Tooltip label="Open worktree in editor" action="openInEditor" side="left">
            <button
              onClick={() => onOpenInEditor(activeWorktreePath)}
              className={btnClass()}
            >
              <Code2 className="w-3.5 h-3.5" />
            </button>
          </Tooltip>
          {isLocalBackend && (
            <Tooltip label="Reveal in Finder" side="left">
              <button
                onClick={() => onRevealInFinder(activeWorktreePath)}
                className={btnClass()}
              >
                <FolderOpen className="w-3.5 h-3.5" />
              </button>
            </Tooltip>
          )}
        </div>
      )}
    </div>
  )
}
