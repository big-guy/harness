import { describe, it, expect } from 'vitest'
import { searchScrollbackBuffers, stripAnsi } from './pty-manager'

describe('stripAnsi', () => {
  it('removes SGR color codes', () => {
    expect(stripAnsi('\x1b[31mred\x1b[0m')).toBe('red')
  })

  it('removes OSC sequences (terminal title etc.)', () => {
    expect(stripAnsi('\x1b]0;title\x07hello')).toBe('hello')
  })

  it('passes through plain text', () => {
    expect(stripAnsi('plain text\nwith newline')).toBe('plain text\nwith newline')
  })
})

describe('searchScrollbackBuffers', () => {
  it('finds case-insensitive substring matches', () => {
    const matches = searchScrollbackBuffers(
      [['t1', 'hello WORLD']],
      'world'
    )
    expect(matches).toHaveLength(1)
    expect(matches[0].terminalId).toBe('t1')
    expect(matches[0].snippet).toBe('hello WORLD')
    expect(matches[0].matchStart).toBe(6)
    expect(matches[0].matchEnd).toBe(11)
  })

  it('strips ANSI before matching so color codes do not break the search', () => {
    const matches = searchScrollbackBuffers(
      [['t1', 'error: \x1b[31mTypeError\x1b[0m foo']],
      'TypeError'
    )
    expect(matches).toHaveLength(1)
    expect(matches[0].snippet).not.toContain('\x1b')
    expect(matches[0].snippet).toContain('TypeError')
  })

  it('returns multiple matches in the same buffer', () => {
    const matches = searchScrollbackBuffers(
      [['t1', 'foo bar foo baz foo']],
      'foo'
    )
    expect(matches).toHaveLength(3)
    expect(matches.every((m) => m.terminalId === 't1')).toBe(true)
  })

  it('returns matches across multiple buffers', () => {
    const matches = searchScrollbackBuffers(
      [
        ['a', 'apple'],
        ['b', 'apricot apple'],
        ['c', 'banana']
      ],
      'apple'
    )
    expect(matches.map((m) => m.terminalId)).toEqual(['a', 'b'])
  })

  it('respects the limit', () => {
    const matches = searchScrollbackBuffers(
      [['t1', 'x x x x x x x x x x']],
      'x',
      { limit: 3 }
    )
    expect(matches).toHaveLength(3)
  })

  it('returns surrounding context', () => {
    const long = 'a'.repeat(200) + 'NEEDLE' + 'b'.repeat(200)
    const matches = searchScrollbackBuffers([['t1', long]], 'NEEDLE', {
      context: 10
    })
    expect(matches).toHaveLength(1)
    expect(matches[0].snippet).toBe('aaaaaaaaaaNEEDLEbbbbbbbbbb')
    expect(matches[0].matchStart).toBe(10)
    expect(matches[0].matchEnd).toBe(16)
  })

  it('reports lineIndex (newlines before the match)', () => {
    const text = 'line0\nline1\nNEEDLE here\nline3'
    const matches = searchScrollbackBuffers([['t1', text]], 'NEEDLE')
    expect(matches).toHaveLength(1)
    expect(matches[0].lineIndex).toBe(2)
  })

  it('returns nothing for an empty query', () => {
    expect(searchScrollbackBuffers([['t1', 'anything']], '')).toEqual([])
    expect(searchScrollbackBuffers([['t1', 'anything']], '   ')).toEqual([])
  })

  it('returns nothing when nothing matches', () => {
    expect(
      searchScrollbackBuffers([['t1', 'nothing here']], 'absent')
    ).toEqual([])
  })
})
