import { createPortal } from 'react-dom'
import { Check, X } from 'lucide-react'
import { useSettings } from '../store'

interface WorktreeHoverPreviewProps {
  anchorRect: DOMRect
  text: string
  onSelect: () => void
  onMouseEnter: () => void
  onMouseLeave: () => void
}

const MAX_LINES = 10

export function WorktreeHoverPreview({
  anchorRect,
  text,
  onSelect,
  onMouseEnter,
  onMouseLeave
}: WorktreeHoverPreviewProps): JSX.Element {
  const terminalFont = useSettings().terminalFontFamily ||
    "'SF Mono', 'Monaco', 'Menlo', 'Courier New', monospace"

  const lines = text ? text.split('\n').slice(-MAX_LINES) : []
  const display = lines.join('\n')

  const gap = 8
  const margin = 24
  const left = anchorRect.right + gap
  const width = Math.max(320, window.innerWidth - left - margin)
  const top = anchorRect.top

  const handleNoopCheck = (e: React.MouseEvent): void => {
    e.stopPropagation()
    // TODO: wire up the checkmark action once the user specifies what it should do.
  }
  const handleNoopCross = (e: React.MouseEvent): void => {
    e.stopPropagation()
    // TODO: wire up the cross action once the user specifies what it should do.
  }

  return createPortal(
    <div
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      className="fixed z-50 flex rounded-lg overflow-hidden shadow-2xl ring-1 ring-border"
      style={{ top, left, width }}
    >
      <div className="flex flex-col bg-panel border-r border-border">
        <button
          onClick={handleNoopCheck}
          title="(placeholder)"
          className="p-1.5 text-faint hover:text-success hover:bg-surface transition-colors cursor-pointer"
        >
          <Check size={14} />
        </button>
        <button
          onClick={handleNoopCross}
          title="(placeholder)"
          className="p-1.5 text-faint hover:text-danger hover:bg-surface transition-colors cursor-pointer"
        >
          <X size={14} />
        </button>
      </div>
      <button
        onClick={onSelect}
        className="flex-1 text-left px-3 py-2 min-w-0 cursor-pointer hover:brightness-110 transition-all"
        style={{ backgroundColor: 'var(--color-app)' }}
      >
        <pre
          className="text-[10px] leading-tight whitespace-pre-wrap break-all"
          style={{
            fontFamily: terminalFont,
            color: 'var(--color-fg-bright)'
          }}
        >
          {display || <span className="text-faint italic">no output yet</span>}
        </pre>
      </button>
    </div>,
    document.body
  )
}
