import { useEffect, useRef, useCallback } from 'react'
import { ChevronRight, Check } from 'lucide-react'
import type { ChangedFile } from '../types'
import type {
  Rank,
  WorktreeFileRanks,
  FileRankEntry
} from '../../shared/state/file-ranks'

export interface ReviewComment {
  id: string
  filePath: string
  lineNumber: number
  body: string
  timestamp: number
}

export type SortMode = 'path' | 'rank'

interface ReviewFileTreeProps {
  files: ChangedFile[]
  selectedFile: string | null
  reviewedFiles: Set<string>
  comments: ReviewComment[]
  collapsedDirs: Set<string>
  fileRanks: WorktreeFileRanks | undefined
  sortMode: SortMode
  onSelectFile: (path: string) => void
  onToggleReviewed: (path: string) => void
  onToggleDir: (dir: string) => void
}

const STATUS_LABEL: Record<ChangedFile['status'], string> = {
  added: 'A',
  modified: 'M',
  deleted: 'D',
  renamed: 'R',
  untracked: 'U'
}

const STATUS_COLOR: Record<ChangedFile['status'], string> = {
  added: 'text-success',
  modified: 'text-warning',
  deleted: 'text-danger',
  renamed: 'text-info',
  untracked: 'text-dim'
}

const RANK_ORDER: Rank[] = ['important', 'normal', 'trivial', 'uninteresting']

const RANK_GROUP_COLOR: Record<Rank, string> = {
  important: 'text-warning',
  normal: 'text-fg',
  trivial: 'text-faint',
  uninteresting: 'text-dim'
}

const RANK_GROUP_LABEL: Record<Rank, string> = {
  important: 'Important',
  normal: 'Normal',
  trivial: 'Trivial',
  uninteresting: 'Uninteresting'
}

function effectiveRank(entry: FileRankEntry | undefined): Rank {
  return entry?.rank ?? 'normal'
}

interface FileGroup {
  /** Key used by collapsedDirs. For rank groups it's `__rank:<rank>`. */
  key: string
  /** Display label for the group header. */
  label: string
  /** Tailwind class for the header label. */
  labelClass?: string
  /** Whether to render a header at all (path mode hides empty-string dir). */
  showHeader: boolean
  files: ChangedFile[]
}

function compareFiles(a: ChangedFile, b: ChangedFile): number {
  const statusOrder = (s: ChangedFile['status']): number => {
    if (s === 'deleted') return 0
    if (s === 'modified') return 1
    return 2
  }
  const oa = statusOrder(a.status)
  const ob = statusOrder(b.status)
  if (oa !== ob) return oa - ob
  const sizeA = (a.additions ?? 0) + (a.deletions ?? 0)
  const sizeB = (b.additions ?? 0) + (b.deletions ?? 0)
  if (sizeA !== sizeB) return sizeB - sizeA
  return a.path.localeCompare(b.path)
}

function groupByPath(files: ChangedFile[]): FileGroup[] {
  const groups = new Map<string, ChangedFile[]>()
  for (const file of files) {
    const lastSlash = file.path.lastIndexOf('/')
    const dir = lastSlash >= 0 ? file.path.slice(0, lastSlash + 1) : ''
    const list = groups.get(dir) || []
    list.push(file)
    groups.set(dir, list)
  }
  const result: FileGroup[] = []
  for (const [dir, dirFiles] of groups) {
    dirFiles.sort(compareFiles)
    result.push({
      key: dir,
      label: dir,
      showHeader: dir.length > 0,
      files: dirFiles
    })
  }
  result.sort((a, b) => a.key.localeCompare(b.key))
  return result
}

function groupByRank(
  files: ChangedFile[],
  fileRanks: WorktreeFileRanks | undefined
): FileGroup[] {
  const buckets: Record<Rank, ChangedFile[]> = {
    important: [],
    normal: [],
    trivial: [],
    uninteresting: []
  }
  for (const file of files) {
    const rank = effectiveRank(fileRanks?.entries[file.path])
    buckets[rank].push(file)
  }
  const result: FileGroup[] = []
  for (const rank of RANK_ORDER) {
    const bucket = buckets[rank]
    if (bucket.length === 0) continue
    bucket.sort(compareFiles)
    result.push({
      key: `__rank:${rank}`,
      label: RANK_GROUP_LABEL[rank],
      labelClass: RANK_GROUP_COLOR[rank],
      showHeader: true,
      files: bucket
    })
  }
  return result
}

function flatFileList(groups: FileGroup[], collapsedDirs: Set<string>): ChangedFile[] {
  const result: ChangedFile[] = []
  for (const group of groups) {
    if (!collapsedDirs.has(group.key)) {
      result.push(...group.files)
    }
  }
  return result
}

const MAX_STAT_BLOCKS = 5

function DiffStatBar({ additions, deletions }: { additions: number; deletions: number }): JSX.Element {
  const total = additions + deletions
  if (total === 0) return <span className="shrink-0 w-[50px]" />
  const addBlocks = Math.round((additions / total) * MAX_STAT_BLOCKS)
  const delBlocks = MAX_STAT_BLOCKS - addBlocks
  return (
    <span className="shrink-0 flex items-center gap-1">
      <span className="font-mono text-[10px] tabular-nums text-faint">{total}</span>
      <span className="flex gap-px">
        {Array.from({ length: addBlocks }, (_, i) => (
          <span key={`a${i}`} className="w-[6px] h-[6px] rounded-[1px] bg-success" />
        ))}
        {Array.from({ length: delBlocks }, (_, i) => (
          <span key={`d${i}`} className="w-[6px] h-[6px] rounded-[1px] bg-danger" />
        ))}
      </span>
    </span>
  )
}

export function ReviewFileTree({
  files,
  selectedFile,
  reviewedFiles,
  comments,
  collapsedDirs,
  fileRanks,
  sortMode,
  onSelectFile,
  onToggleReviewed,
  onToggleDir
}: ReviewFileTreeProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const groups =
    sortMode === 'rank' ? groupByRank(files, fileRanks) : groupByPath(files)
  const navigableFiles = flatFileList(groups, collapsedDirs)

  const commentCountByFile = new Map<string, number>()
  for (const c of comments) {
    commentCountByFile.set(c.filePath, (commentCountByFile.get(c.filePath) ?? 0) + 1)
  }

  const navigateFile = useCallback(
    (delta: number) => {
      if (navigableFiles.length === 0) return
      const currentIdx = navigableFiles.findIndex((f) => f.path === selectedFile)
      let nextIdx: number
      if (currentIdx < 0) {
        nextIdx = 0
      } else {
        nextIdx = Math.max(0, Math.min(navigableFiles.length - 1, currentIdx + delta))
      }
      onSelectFile(navigableFiles[nextIdx].path)
    },
    [navigableFiles, selectedFile, onSelectFile]
  )

  const navigateUnreviewed = useCallback(
    (delta: number) => {
      const unreviewed = navigableFiles.filter((f) => !reviewedFiles.has(f.path))
      if (unreviewed.length === 0) return
      const currentIdx = unreviewed.findIndex((f) => f.path === selectedFile)
      let nextIdx: number
      if (currentIdx < 0) {
        nextIdx = delta > 0 ? 0 : unreviewed.length - 1
      } else {
        nextIdx = (currentIdx + delta + unreviewed.length) % unreviewed.length
      }
      onSelectFile(unreviewed[nextIdx].path)
    },
    [navigableFiles, reviewedFiles, selectedFile, onSelectFile]
  )

  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      if (
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLInputElement
      ) {
        return
      }
      if (e.key === 'j' || (e.key === 'ArrowDown' && !e.metaKey)) {
        e.preventDefault()
        navigateFile(1)
      } else if (e.key === 'k' || (e.key === 'ArrowUp' && !e.metaKey)) {
        e.preventDefault()
        navigateFile(-1)
      } else if (e.key === ']') {
        e.preventDefault()
        navigateUnreviewed(1)
      } else if (e.key === '[') {
        e.preventDefault()
        navigateUnreviewed(-1)
      } else if (e.key === 'r' && !e.metaKey && !e.ctrlKey) {
        e.preventDefault()
        if (selectedFile) {
          const wasReviewed = reviewedFiles.has(selectedFile)
          onToggleReviewed(selectedFile)
          if (!wasReviewed) {
            const unreviewed = navigableFiles.filter(
              (f) => !reviewedFiles.has(f.path) && f.path !== selectedFile
            )
            if (unreviewed.length > 0) {
              const currentIdx = navigableFiles.findIndex((f) => f.path === selectedFile)
              const next = unreviewed.find(
                (f) => navigableFiles.indexOf(f) > currentIdx
              ) ?? unreviewed[0]
              onSelectFile(next.path)
            }
          }
        }
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [navigateFile, navigateUnreviewed, selectedFile, onToggleReviewed])

  return (
    <div ref={containerRef} className="flex flex-col h-full overflow-y-auto text-xs select-none">
      {groups.map((group) => {
        const isCollapsed = collapsedDirs.has(group.key)
        return (
          <div key={group.key}>
            {group.showHeader && (
              <button
                onClick={() => onToggleDir(group.key)}
                className={`w-full flex items-center gap-1 px-2 py-1 text-[10px] font-medium uppercase tracking-wider bg-panel-raised/50 hover:bg-panel-raised cursor-pointer ${
                  group.labelClass ?? 'text-dim'
                }`}
              >
                <ChevronRight
                  size={10}
                  className={`transition-transform ${isCollapsed ? '' : 'rotate-90'}`}
                />
                {group.label}
              </button>
            )}
            {!isCollapsed &&
              group.files.map((file) => {
                const displayName =
                  sortMode === 'path' && group.key
                    ? file.path.slice(group.key.length)
                    : file.path
                const isSelected = file.path === selectedFile
                const isReviewed = reviewedFiles.has(file.path)
                const commentCount = commentCountByFile.get(file.path) ?? 0
                const entry = fileRanks?.entries[file.path]
                const rank = effectiveRank(entry)
                const dimForUninteresting = rank === 'uninteresting'
                return (
                  <div
                    key={file.path}
                    onClick={() => onSelectFile(file.path)}
                    className={`flex items-center gap-1.5 px-2 py-1 cursor-pointer transition-colors ${
                      isSelected
                        ? 'bg-accent/15 border-l-2 border-accent'
                        : 'border-l-2 border-transparent hover:bg-panel-raised'
                    } ${isReviewed || dimForUninteresting ? 'opacity-50' : ''}`}
                  >
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        onToggleReviewed(file.path)
                      }}
                      className={`shrink-0 w-3.5 h-3.5 rounded border flex items-center justify-center transition-colors cursor-pointer ${
                        isReviewed
                          ? 'bg-success/20 border-success text-success'
                          : 'border-border-strong text-transparent hover:border-faint'
                      }`}
                    >
                      {isReviewed && <Check size={9} strokeWidth={3} />}
                    </button>

                    <span className={`shrink-0 w-3 font-mono text-[10px] ${STATUS_COLOR[file.status]}`}>
                      {STATUS_LABEL[file.status]}
                    </span>

                    <span className="truncate flex-1 text-fg">{displayName}</span>

                    {(file.additions !== undefined || file.deletions !== undefined) && (
                      <DiffStatBar additions={file.additions ?? 0} deletions={file.deletions ?? 0} />
                    )}

                    {commentCount > 0 && (
                      <span className="shrink-0 text-[9px] bg-info/20 text-info px-1 rounded-full tabular-nums">
                        {commentCount}
                      </span>
                    )}
                  </div>
                )
              })}
          </div>
        )
      })}
    </div>
  )
}

