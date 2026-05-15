import { Star, StarHalf, StarOff } from 'lucide-react'
import type { Rank, RankSource } from '../../shared/state/file-ranks'

export const NEXT_RANK_ON_CYCLE: Record<Rank, Rank> = {
  normal: 'important',
  important: 'trivial',
  trivial: 'uninteresting',
  uninteresting: 'normal'
}

const RANK_LABEL: Record<Rank, string> = {
  important: 'important',
  normal: 'normal',
  trivial: 'trivial',
  uninteresting: 'uninteresting'
}

interface FileRankButtonProps {
  rank: Rank
  source: RankSource | 'default'
  size?: number
  onCycle: () => void
  onShiftClick: () => void
}

export function FileRankButton({
  rank,
  source,
  size = 14,
  onCycle,
  onShiftClick
}: FileRankButtonProps): JSX.Element {
  const isAgent = source === 'agent'
  const title = isAgent
    ? 'Agent suggestion — click to override'
    : source === 'default'
      ? 'Rank: unranked. Click to cycle. Shift-click to mark uninteresting.'
      : `Rank: ${RANK_LABEL[rank]}. Click to cycle. Shift-click to mark uninteresting.`

  let iconEl: JSX.Element
  if (rank === 'important') {
    iconEl = <Star size={size} fill="currentColor" className="text-warning" />
  } else if (rank === 'uninteresting') {
    iconEl = <StarOff size={size} className="text-faint" />
  } else if (rank === 'trivial') {
    iconEl = <StarHalf size={size} className="text-faint -scale-x-100" />
  } else {
    iconEl = <StarHalf size={size} className="text-faint" />
  }

  return (
    <button
      type="button"
      title={title}
      onClick={(e) => {
        e.stopPropagation()
        if (e.shiftKey) {
          onShiftClick()
        } else {
          onCycle()
        }
      }}
      className={`shrink-0 rounded flex items-center justify-center cursor-pointer transition-colors hover:bg-panel-raised p-0.5 ${
        isAgent ? 'ring-1 ring-faint/50' : ''
      }`}
    >
      {iconEl}
    </button>
  )
}
