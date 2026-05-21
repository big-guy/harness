export interface ScrollbackSearchResult {
  terminalId: string
  worktreeId: string
  paneId: string
  tabLabel: string
  tabType: string
  worktreeBranch: string
  worktreeRepoRoot: string
  snippet: string
  matchStart: number
  matchEnd: number
  lineIndex: number
}
