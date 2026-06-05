import type { BadgeColor, BadgeShape, ClaudeAccountBadge as Badge } from '../../shared/state/repo-local'

// SVG fill colors per badge color. Kept as hex strings so the four
// shapes (all rendered as SVG paths/polygons) can share one render
// path — there's no tailwind bg-* fallback for SVG fills.
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

function ShapeContent({ shape, color }: { shape: BadgeShape; color: string }): JSX.Element {
  switch (shape) {
    case 'square':
      return <rect x="1" y="1" width="8" height="8" fill={color} />
    case 'hexagon':
      // Pointy-top regular hexagon, centered on (5,5) with radius 4.
      return (
        <polygon
          points="5,1 8.46,3 8.46,7 5,9 1.54,7 1.54,3"
          fill={color}
        />
      )
    case 'cross':
      // Plus sign, 3-unit-thick bars, 9-unit length, centered on (5,5).
      return (
        <path
          d="M 3.5 0.5 H 6.5 V 3.5 H 9.5 V 6.5 H 6.5 V 9.5 H 3.5 V 6.5 H 0.5 V 3.5 H 3.5 Z"
          fill={color}
        />
      )
    case 'diamond':
      // Rotated square — four cardinal points of the viewBox.
      return <polygon points="5,1 9,5 5,9 1,5" fill={color} />
  }
}

export function ClaudeAccountBadge({
  badge,
  sizeClass = 'w-2.5 h-2.5',
  title
}: ClaudeAccountBadgeProps): JSX.Element {
  return (
    <svg
      viewBox="0 0 10 10"
      className={`${sizeClass} shrink-0`}
      aria-hidden={title ? undefined : true}
    >
      {title && <title>{title}</title>}
      <ShapeContent shape={badge.shape} color={COLOR_FILL[badge.color]} />
    </svg>
  )
}

export { COLOR_FILL as BADGE_COLOR_FILL }
