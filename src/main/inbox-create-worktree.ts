import { execFile } from 'child_process'
import { promisify } from 'util'
import { log } from './debug'
import { getPRRef } from './github'
import type { Worktree } from '../shared/state/worktrees'

const execFileAsync = promisify(execFile)

export interface InboxItemRef {
  kind: 'issue' | 'pr'
  owner: string
  repo: string
  number: number
  /** Item title — used to slugify the branch name for issues. */
  title: string
  /** Overrides the auto-generated kickoff prompt. Set when a specific
   *  drag handle (e.g. "Fix this" / "Investigate this") seeds the new
   *  worktree with its own prompt instead of the default review/issue one. */
  initialPrompt?: string
}

export type InboxCreateOutcome =
  | { kind: 'pending'; pendingId: string; repoRoot: string; branchName: string; initialPrompt: string }
  | { kind: 'existing'; worktreePath: string }

interface PrepareDeps {
  /** Returns the user's tracked repo roots. */
  getRepoRoots: () => string[]
  /** Reads remote.origin.url for a repoRoot and parses it to owner/repo. */
  getOriginInfo: (repoRoot: string) => Promise<{ owner: string; repo: string } | null>
  /** Current flat worktree list from the store, used to detect collisions. */
  getWorktreeList: () => Worktree[]
  /** Generates a pending id (so it can be deterministic in tests). */
  generatePendingId: () => string
  /** Prefix for PR branches (default `pr/`). Final branch is `${prefix}${n}`. */
  getPRBranchPrefix: () => string
  /** Prefix for issue branches (default `issue-`). Final branch is
   *  `${prefix}${n}-${slug}` (or just `${prefix}${n}` for empty slug). */
  getIssueBranchPrefix: () => string
}

/** Resolve an inbox item to a worktree action.
 *
 *  - For PRs we fetch the head ref into a namespaced local branch
 *    `pr/<n>` (force-updated to match the remote on each invocation).
 *    Same-repo and fork PRs both end up on `pr/<n>`; fork PRs fetch
 *    from the fork's clone URL instead of origin.
 *  - For issues we generate `issue-<n>-<slug>` off the repo's default
 *    base via the existing addWorktree flow.
 *
 *  If a worktree already exists for the target branch we return
 *  `{kind:'existing', worktreePath}` so the caller can navigate to it
 *  instead of creating a duplicate.
 */
export async function prepareInboxWorktree(
  ref: InboxItemRef,
  deps: PrepareDeps
): Promise<InboxCreateOutcome> {
  const repoRoot = await resolveRepoRoot(ref.owner, ref.repo, deps)
  if (!repoRoot) {
    throw new Error(
      `Add the ${ref.owner}/${ref.repo} repository to Harness first.`
    )
  }

  if (ref.kind === 'pr') {
    return await preparePR(ref, repoRoot, deps)
  } else {
    return await prepareIssue(ref, repoRoot, deps)
  }
}

async function resolveRepoRoot(
  owner: string,
  repo: string,
  deps: PrepareDeps
): Promise<string | null> {
  const wantedKey = `${owner.toLowerCase()}/${repo.toLowerCase()}`
  for (const root of deps.getRepoRoots()) {
    const info = await deps.getOriginInfo(root)
    if (!info) continue
    if (`${info.owner.toLowerCase()}/${info.repo.toLowerCase()}` === wantedKey) {
      return root
    }
  }
  return null
}

async function preparePR(
  ref: InboxItemRef,
  repoRoot: string,
  deps: PrepareDeps
): Promise<InboxCreateOutcome> {
  const branchName = makePRBranchName(ref.number, deps.getPRBranchPrefix())

  // Already have a worktree for this PR? Reuse it.
  const existing = deps.getWorktreeList().find(
    (w) => w.repoRoot === repoRoot && w.branch === branchName
  )
  if (existing) {
    return { kind: 'existing', worktreePath: existing.path }
  }

  const prRef = await getPRRef(ref.owner, ref.repo, ref.number)
  if (!prRef) {
    throw new Error(
      `Could not look up PR #${ref.number} on GitHub. Check your token has access to ${ref.owner}/${ref.repo}.`
    )
  }

  // Fetch the head ref into a local `pr/<n>` branch. `+` forces non-FF
  // update so re-clicking the button after upstream rebase still works.
  const remote = prRef.isFork ? prRef.headCloneUrl : 'origin'
  const refspec = `+refs/heads/${prRef.headRef}:refs/heads/${branchName}`
  log('inbox-create-worktree', `git fetch ${remote} ${refspec} (cwd=${repoRoot})`)
  try {
    await execFileAsync('git', ['fetch', remote, refspec], { cwd: repoRoot })
  } catch (err) {
    throw new Error(
      `Failed to fetch PR head ref: ${err instanceof Error ? err.message : String(err)}`
    )
  }

  const initialPrompt = ref.initialPrompt?.trim() || buildPRPrompt(ref, prRef.isFork)
  return {
    kind: 'pending',
    pendingId: deps.generatePendingId(),
    repoRoot,
    branchName,
    initialPrompt
  }
}

async function prepareIssue(
  ref: InboxItemRef,
  repoRoot: string,
  deps: PrepareDeps
): Promise<InboxCreateOutcome> {
  const branchName = makeIssueBranchName(
    ref.number,
    ref.title,
    deps.getIssueBranchPrefix()
  )

  const existing = deps.getWorktreeList().find(
    (w) => w.repoRoot === repoRoot && w.branch === branchName
  )
  if (existing) {
    return { kind: 'existing', worktreePath: existing.path }
  }

  const initialPrompt = ref.initialPrompt?.trim() || buildIssuePrompt(ref)
  return {
    kind: 'pending',
    pendingId: deps.generatePendingId(),
    repoRoot,
    branchName,
    initialPrompt
  }
}

export function makePRBranchName(number: number, prefix: string): string {
  return `${prefix}${number}`
}

export function makeIssueBranchName(
  number: number,
  title: string,
  prefix: string
): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '')
  return slug ? `${prefix}${number}-${slug}` : `${prefix}${number}`
}

function buildPRPrompt(ref: InboxItemRef, isFork: boolean): string {
  const url = `https://github.com/${ref.owner}/${ref.repo}/pull/${ref.number}`
  return [
    `You are reviewing pull request #${ref.number} in ${ref.owner}/${ref.repo}.`,
    `Title: ${ref.title}`,
    `URL: ${url}`,
    isFork ? 'This PR comes from a fork.' : '',
    'Read the change and write a thorough review. Look for bugs, missing tests, and unclear naming.'
  ]
    .filter(Boolean)
    .join('\n')
}

function buildIssuePrompt(ref: InboxItemRef): string {
  const url = `https://github.com/${ref.owner}/${ref.repo}/issues/${ref.number}`
  return [
    `You are working on issue #${ref.number} in ${ref.owner}/${ref.repo}.`,
    `Title: ${ref.title}`,
    `URL: ${url}`,
    'Read the issue description, then propose an approach before making changes.'
  ].join('\n')
}
