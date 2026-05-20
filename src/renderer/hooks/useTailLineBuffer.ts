import { useEffect, useRef, useState } from 'react'
import { useBackend } from '../backend'

/** Rolling per-terminal "last few lines of output" cache for the
 * CommandCenter preview. Taps the terminal:data stream the main process
 * already broadcasts; buffers chunks in a ref and flushes a derived state
 * map every 500ms so we don't re-render the world on every PTY byte.
 *
 * Returns the latest tail-line map keyed by terminal id. Strips ANSI
 * escape sequences and box-drawing characters, drops lines that are
 * mostly whitespace, and keeps the last 4 meaningful lines per terminal
 * truncated to 240 characters each.
 *
 * Pass `enabled=false` (the default at App scope when CommandCenter is
 * closed) to skip the subscription AND the flush entirely \u2014 without the
 * gate, a chatty PTY (e.g. `npm run dev`) keeps the buffer permanently
 * dirty, fires a setState every 500ms, and re-renders the App tree
 * forever for output nobody is looking at. */
export interface TailLineBufferOpts {
  /** Max number of trailing lines to expose per terminal. Default 4. */
  maxLines?: number
  /** Trailing chars to retain in the rolling raw buffer. Default 4096. */
  bufferBytes?: number
  /** Flush interval in ms \u2014 how often the derived lines map is updated.
   *  Default 500ms (matches CommandCenter's tolerance). */
  flushMs?: number
  /** Skip the "\u22653 word chars" meaningful-line filter. Default false. */
  includeBlanks?: boolean
  /** Keep Unicode box-drawing characters instead of replacing them with
   *  spaces. Lets the consumer render a TUI as-is. Default false. */
  preserveBoxDrawing?: boolean
  /** Max chars per line. Default 240. */
  maxLineLength?: number
}

/** Rolling per-terminal "last few lines of output" cache for previews of
 * agent activity. Taps the terminal:data stream the main process already
 * broadcasts; buffers chunks in a ref and flushes a derived state map
 * periodically so we don't re-render the world on every PTY byte.
 *
 * Defaults match the original CommandCenter shape (4 meaningful lines,
 * box-drawing stripped, 500ms flush, 4096-byte tail). Pass an opts object
 * to tune for a richer preview \u2014 e.g. the sidebar hover preview captures
 * 20 lines, preserves box-drawing so the TUI looks like a TUI, and
 * flushes every 200ms for a more "live" feel.
 *
 * Pass `enabled=false` (the default at App scope when no consumer is
 * visible) to skip the subscription AND the flush entirely \u2014 without the
 * gate, a chatty PTY keeps the buffer permanently dirty, fires a
 * setState every flushMs, and re-renders the App tree forever for output
 * nobody is looking at. */
export function useTailLineBuffer(
  enabled = true,
  opts: TailLineBufferOpts = {}
): Record<string, string> {
  const {
    maxLines = 4,
    bufferBytes = 4096,
    flushMs = 500,
    includeBlanks = false,
    preserveBoxDrawing = false,
    maxLineLength = 240
  } = opts
  const [tailLines, setTailLines] = useState<Record<string, string>>({})
  const tailBuffersRef = useRef<Record<string, string>>({})
  const tailDirtyRef = useRef(false)
  const backend = useBackend()

  useEffect(() => {
    if (!enabled) return
    const stripAnsi = (s: string): string =>
      // eslint-disable-next-line no-control-regex
      s.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '').replace(/\x1b\][^\x07\x1b]*(\x07|\x1b\\)/g, '')

    const cleanup = backend.onTerminalData((id, data) => {
      const prev = tailBuffersRef.current[id] || ''
      const next = (prev + data).slice(-bufferBytes)
      tailBuffersRef.current[id] = next
      tailDirtyRef.current = true
    })

    const flush = setInterval(() => {
      if (!tailDirtyRef.current) return
      tailDirtyRef.current = false
      const out: Record<string, string> = {}
      const isMeaningful = (line: string): boolean => {
        const stripped = line.replace(/[\u2500-\u257F\u2580-\u259F]/g, '')
        const wordChars = stripped.match(/[\p{L}\p{N}]/gu)
        return !!wordChars && wordChars.length >= 3
      }
      for (const [id, buf] of Object.entries(tailBuffersRef.current)) {
        const stripped = stripAnsi(buf).replace(/\r/g, '')
        const rawLines = stripped.split('\n')
        const normalized = preserveBoxDrawing
          ? rawLines.map((l) => l.replace(/\s+$/g, ''))
          : rawLines.map((l) =>
              l.replace(/[\u2500-\u257F\u2580-\u259F]+/g, ' ').replace(/\s+/g, ' ').trim()
            )
        const filtered = includeBlanks ? normalized : normalized.filter(isMeaningful)
        const last = filtered.slice(-maxLines).map((l) => l.slice(0, maxLineLength))
        out[id] = last.join('\n')
      }
      setTailLines(out)
    }, flushMs)

    return () => {
      cleanup()
      clearInterval(flush)
    }
  }, [
    enabled,
    backend,
    bufferBytes,
    flushMs,
    maxLines,
    includeBlanks,
    preserveBoxDrawing,
    maxLineLength
  ])

  return tailLines
}
