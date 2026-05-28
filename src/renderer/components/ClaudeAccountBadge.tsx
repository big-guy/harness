import type { BadgeColor, BadgeShape, ClaudeAccountBadge as Badge } from '../../shared/state/repo-local'

// Concrete tailwind classes keyed by BadgeColor. Listed verbatim so the
// Tailwind compiler can see them — interpolation like `bg-${color}-500`
// would get tree-shaken.
const COLOR_BG: Record<BadgeColor, string> = {
  blue: 'bg-blue-500',
  green: 'bg-emerald-500',
  orange: 'bg-orange-500',
  purple: 'bg-purple-500',
  red: 'bg-red-500',
  yellow: 'bg-amber-400'
}

// SVG fill colors that match COLOR_BG. Triangle uses an SVG path so it
// can't ride on a Tailwind bg-* class.
const COLOR_FILL: Record<BadgeColor, string> = {
  blue: '#3b82f6',
  green: '#10b981',
  orange: '#f97316',
  purple: '#a855f7',
  red: '#ef4444',
  yellow: '#fbbf24'
}

interface ClaudeAccountBadgeProps {
  badge: Badge
  /** Tailwind size class for the bounding box — defaults to ~10px. The
   *  CollapsedRightPanel uses the default; the Usage panel header may
   *  pass a smaller one when sitting alongside the title text. */
  sizeClass?: string
  title?: string
}

export function ClaudeAccountBadge({
  badge,
  sizeClass = 'w-2.5 h-2.5',
  title
}: ClaudeAccountBadgeProps): JSX.Element {
  if (badge.shape === 'triangle') {
    return (
      <svg
        viewBox="0 0 10 10"
        className={`${sizeClass} shrink-0`}
        aria-hidden="true"
      >
        {title && <title>{title}</title>}
        <polygon points="5,1 9,9 1,9" fill={COLOR_FILL[badge.color]} />
      </svg>
    )
  }
  const shapeClass =
    badge.shape === 'circle'
      ? 'rounded-full'
      : badge.shape === 'diamond'
        ? 'rotate-45'
        : 'rounded-sm'
  return (
    <span
      className={`${sizeClass} ${COLOR_BG[badge.color]} ${shapeClass} shrink-0 inline-block`}
      title={title}
      aria-hidden={title ? undefined : true}
    />
  )
}

export { COLOR_BG as BADGE_COLOR_BG, COLOR_FILL as BADGE_COLOR_FILL }
