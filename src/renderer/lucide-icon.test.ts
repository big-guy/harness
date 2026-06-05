import { describe, it, expect } from 'vitest'
import { resolveLucideIcon } from './lucide-icon'

describe('resolveLucideIcon', () => {
  it('resolves an exact PascalCase name', () => {
    expect(resolveLucideIcon('Play')).toBeTruthy()
    expect(resolveLucideIcon('FlaskConical')).toBeTruthy()
  })

  it('resolves kebab-case and spaced variants', () => {
    expect(resolveLucideIcon('flask-conical')).toBe(resolveLucideIcon('FlaskConical'))
    expect(resolveLucideIcon('circle play')).toBe(resolveLucideIcon('CirclePlay'))
  })

  it('preserves trailing digits (e.g. Building2)', () => {
    expect(resolveLucideIcon('building-2')).toBe(resolveLucideIcon('Building2'))
  })

  it('returns null for unknown / empty names', () => {
    expect(resolveLucideIcon('NotARealIcon')).toBeNull()
    expect(resolveLucideIcon('')).toBeNull()
    expect(resolveLucideIcon(undefined)).toBeNull()
    expect(resolveLucideIcon(null)).toBeNull()
  })
})
