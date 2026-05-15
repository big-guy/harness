import { useEffect, useRef, useState } from 'react'
import { Octagon, OctagonAlert, OctagonMinus, OctagonX } from 'lucide-react'
import type { Rank, RankSource } from '../../shared/state/file-ranks'

/** Click semantics: toggle Important ↔ Normal. Anything else (Trivial,
 *  Uninteresting) collapses to Normal first, then a second click flips
 *  it to Important. "Normal" is represented as the absence of an entry,
 *  so `clearFileRank` is what cycling to Normal triggers — handled by
 *  the caller. */
export const NEXT_RANK_ON_CYCLE: Record<Rank, Rank> = {
  normal: 'important',
  important: 'normal',
  trivial: 'normal',
  uninteresting: 'normal'
}

const RANK_LABEL: Record<Rank, string> = {
  important: 'Important',
  normal: 'Normal',
  trivial: 'Trivial',
  uninteresting: 'Uninteresting'
}

const RANK_DESCRIPTION: Record<Rank, string> = {
  important: 'Flag this for the reviewer.',
  normal: 'Default — no special priority.',
  trivial: 'Low-priority change, glance only.',
  uninteresting: 'Skip — not worth reviewing.'
}

const MENU_ORDER: Rank[] = ['important', 'normal', 'trivial', 'uninteresting']

const LONG_PRESS_MS = 400

interface FileRankButtonProps {
  rank: Rank
  source: RankSource | 'default'
  size?: number
  onCycle: () => void
  onShiftClick: () => void
  onPickRank: (rank: Rank) => void
}

function iconFor(rank: Rank, size: number): JSX.Element {
  if (rank === 'important') return <OctagonAlert size={size} className="text-warning" />
  if (rank === 'uninteresting') return <OctagonX size={size} className="text-faint" />
  if (rank === 'trivial') return <OctagonMinus size={size} className="text-muted" />
  return <Octagon size={size} className="text-muted" />
}

export function FileRankButton({
  rank,
  source,
  size = 14,
  onCycle,
  onShiftClick,
  onPickRank
}: FileRankButtonProps): JSX.Element {
  const isAgent = source === 'agent'
  const [menuOpen, setMenuOpen] = useState(false)
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  const longPressTimerRef = useRef<number | null>(null)
  // When the long-press timer fires, we open the menu and arm this flag
  // so the subsequent `click` event (synthesized after mouseup) doesn't
  // also run the toggle action.
  const longPressedRef = useRef(false)

  const clearLongPressTimer = (): void => {
    if (longPressTimerRef.current !== null) {
      window.clearTimeout(longPressTimerRef.current)
      longPressTimerRef.current = null
    }
  }

  useEffect(() => () => clearLongPressTimer(), [])

  useEffect(() => {
    if (!menuOpen) return
    const handler = (e: MouseEvent): void => {
      if (buttonRef.current && buttonRef.current.contains(e.target as Node)) return
      setMenuOpen(false)
    }
    const keyHandler = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setMenuOpen(false)
    }
    window.addEventListener('mousedown', handler)
    window.addEventListener('keydown', keyHandler)
    return () => {
      window.removeEventListener('mousedown', handler)
      window.removeEventListener('keydown', keyHandler)
    }
  }, [menuOpen])

  const title = isAgent
    ? 'Agent suggestion — click to override'
    : source === 'default'
      ? 'Rank: unranked. Click toggles Important. Shift-click marks Uninteresting. Long-press for all options.'
      : `Rank: ${RANK_LABEL[rank].toLowerCase()}. Click toggles Important. Shift-click marks Uninteresting. Long-press for all options.`

  return (
    <span className="relative inline-flex">
      <button
        ref={buttonRef}
        type="button"
        title={title}
        onMouseDown={(e) => {
          if (e.button !== 0) return
          longPressedRef.current = false
          clearLongPressTimer()
          longPressTimerRef.current = window.setTimeout(() => {
            longPressedRef.current = true
            setMenuOpen(true)
          }, LONG_PRESS_MS)
        }}
        onMouseUp={() => {
          clearLongPressTimer()
        }}
        onMouseLeave={() => {
          clearLongPressTimer()
        }}
        onClick={(e) => {
          e.stopPropagation()
          if (longPressedRef.current) {
            longPressedRef.current = false
            return
          }
          if (e.shiftKey) {
            onShiftClick()
          } else {
            onCycle()
          }
        }}
        onContextMenu={(e) => {
          e.preventDefault()
          e.stopPropagation()
          setMenuOpen(true)
        }}
        className={`shrink-0 rounded flex items-center justify-center cursor-pointer transition-colors hover:bg-panel-raised p-0.5 ${
          isAgent ? 'ring-1 ring-faint/50' : ''
        }`}
      >
        {iconFor(rank, size)}
      </button>

      {menuOpen && (
        <div
          role="menu"
          className="absolute top-full left-0 mt-1 min-w-[180px] bg-surface border border-border rounded-md shadow-xl overflow-hidden z-30"
        >
          {MENU_ORDER.map((r) => {
            const isCurrent = r === rank
            return (
              <button
                key={r}
                type="button"
                role="menuitemradio"
                aria-checked={isCurrent}
                onClick={(e) => {
                  e.stopPropagation()
                  setMenuOpen(false)
                  onPickRank(r)
                }}
                className={`w-full flex items-center gap-2 px-3 py-1.5 text-left text-xs cursor-pointer transition-colors ${
                  isCurrent ? 'bg-accent/15 text-fg-bright' : 'text-fg hover:bg-panel-raised'
                }`}
              >
                <span className="shrink-0 flex items-center justify-center w-4">
                  {iconFor(r, size)}
                </span>
                <span className="font-medium">{RANK_LABEL[r]}</span>
                <span className="ml-auto text-[10px] text-faint truncate">
                  {RANK_DESCRIPTION[r]}
                </span>
              </button>
            )
          })}
        </div>
      )}
    </span>
  )
}
