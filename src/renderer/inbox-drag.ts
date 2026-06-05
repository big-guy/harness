// Shared payload + helpers for dragging an Inbox item onto a drop target
// (an existing worktree row, or the "Add worktree" affordance) in the
// sidebar. Uses native HTML5 drag-and-drop because the drag source
// (InboxScreen) and the drop targets (Sidebar) live in separate component
// trees, so a shared @dnd-kit DndContext would be awkward to thread.
import type { DragEvent } from 'react'

export const INBOX_DRAG_MIME = 'application/x-harness-inbox-item'

export interface InboxDragItem {
  kind: 'issue' | 'pr'
  owner: string
  repo: string
  number: number
  title: string
  /** GitHub html_url of the issue/PR — used to build the dropped prompt. */
  url: string
  /** The prompt to insert when dropped on an EXISTING worktree. Defaults to
   *  "Look at this <url>" for a plain row drag; the "Fix this" /
   *  "Investigate this" handles set their own. */
  prompt: string
  /** Override for the kickoff prompt when dropped on "Add worktree". Only
   *  set by the fix/investigate handles — a plain row drag leaves this unset
   *  so worktree creation uses the default review/issue prompt. */
  worktreePrompt?: string
}

export function setInboxDragData(e: DragEvent, item: InboxDragItem): void {
  e.dataTransfer.setData(INBOX_DRAG_MIME, JSON.stringify(item))
  // A human-readable fallback so dropping outside Harness (e.g. into a
  // text field) yields the link rather than nothing.
  e.dataTransfer.setData('text/plain', item.url)
  e.dataTransfer.effectAllowed = 'copy'
}

/** True while an inbox-item drag is in progress. `getData` is blocked
 *  during dragover for security, so detection relies on `types`. */
export function isInboxDrag(e: DragEvent): boolean {
  return e.dataTransfer.types.includes(INBOX_DRAG_MIME)
}

/** Parse the dragged item on drop. Returns null if the payload is absent
 *  or malformed. */
export function getInboxDragItem(e: DragEvent): InboxDragItem | null {
  const raw = e.dataTransfer.getData(INBOX_DRAG_MIME)
  if (!raw) return null
  try {
    const p = JSON.parse(raw) as Partial<InboxDragItem>
    if (
      p &&
      (p.kind === 'issue' || p.kind === 'pr') &&
      typeof p.owner === 'string' &&
      typeof p.repo === 'string' &&
      typeof p.number === 'number' &&
      typeof p.title === 'string' &&
      typeof p.url === 'string' &&
      typeof p.prompt === 'string'
    ) {
      return p as InboxDragItem
    }
  } catch {
    // malformed — ignore
  }
  return null
}
