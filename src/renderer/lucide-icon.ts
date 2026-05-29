import { icons } from 'lucide-react'

type LucideIconComponent = (typeof icons)[keyof typeof icons]

const registry = icons as Record<string, LucideIconComponent>

/** Resolve a user-provided icon name to a Lucide component, or null if it
 *  isn't a valid Lucide icon. lucide-react's `icons` registry is keyed by
 *  PascalCase ("FlaskConical"); we accept that plus kebab-case
 *  ("flask-conical"), snake_case, and spaced variants by normalizing to
 *  PascalCase. Invalid names resolve to null so callers can simply skip the
 *  icon. */
export function resolveLucideIcon(
  name: string | undefined | null
): LucideIconComponent | null {
  if (!name) return null
  const trimmed = name.trim()
  if (!trimmed) return null
  // Exact registry key (already PascalCase) — also covers names like
  // "Building2" without mangling the trailing digit.
  if (trimmed in registry) return registry[trimmed]
  const pascal = trimmed
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join('')
  return registry[pascal] ?? null
}
