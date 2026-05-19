import { execFile } from 'child_process'
import { promisify } from 'util'
import { log } from './debug'
import { getCachedToken, invalidateTokenCache, resolveGitHubToken } from './github-auth'
import type { CheckStatus, PRReview, PRStatus } from '../shared/state/prs'

export type { CheckStatus, PRReview, PRStatus }

const execFileAsync = promisify(execFile)

/** Parse the GitHub owner/repo from a remote URL like git@github.com:owner/repo.git or https://github.com/owner/repo.git */
function parseRemoteUrl(url: string): { owner: string; repo: string } | null {
  // SSH: git@github.com:owner/repo.git
  const sshMatch = url.match(/[:/]([^/:]+)\/([^/]+?)(?:\.git)?$/)
  if (sshMatch) {
    return { owner: sshMatch[1], repo: sshMatch[2] }
  }
  return null
}

/** Get the GitHub owner/repo for the given worktree by inspecting its origin remote */
async function getRepoInfo(worktreePath: string): Promise<{ owner: string; repo: string } | null> {
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['config', '--get', 'remote.origin.url'],
      { cwd: worktreePath }
    )
    return parseRemoteUrl(stdout.trim())
  } catch {
    return null
  }
}

/** Get the current branch of a worktree */
async function getCurrentBranch(worktreePath: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['rev-parse', '--abbrev-ref', 'HEAD'],
      { cwd: worktreePath }
    )
    const branch = stdout.trim()
    if (!branch || branch === 'HEAD') return null
    return branch
  } catch {
    return null
  }
}

async function doFetch(url: string, token: string | null): Promise<Response> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'Harness',
    'X-GitHub-Api-Version': '2022-11-28'
  }
  if (token) headers.Authorization = `Bearer ${token}`
  return fetch(url, { headers })
}

/** Make an authenticated request to the GitHub REST API. On 401, invalidate the token cache and retry once. */
async function githubFetch(url: string): Promise<unknown> {
  let token = getCachedToken()
  let res = await doFetch(url, token)
  if (res.status === 401) {
    log('github', '401 from GitHub, re-resolving token')
    invalidateTokenCache()
    const resolved = await resolveGitHubToken()
    token = resolved?.token ?? null
    res = await doFetch(url, token)
  }
  if (!res.ok) {
    throw new Error(`GitHub API ${res.status}: ${res.statusText}`)
  }
  return res.json()
}

interface ApiPR {
  number: number
  title: string
  state: 'open' | 'closed'
  draft: boolean
  merged_at: string | null
  html_url: string
  head: { ref: string; sha: string }
}

interface ApiPRDetail extends ApiPR {
  mergeable: boolean | null
  mergeable_state: string
  additions: number
  deletions: number
}

interface ApiCheckRun {
  name: string
  status: 'queued' | 'in_progress' | 'completed' | 'waiting' | 'requested' | 'pending'
  conclusion: 'success' | 'failure' | 'neutral' | 'cancelled' | 'skipped' | 'timed_out' | 'action_required' | null
  html_url?: string | null
  details_url?: string | null
  output?: { title?: string | null; summary?: string | null }
}

interface ApiCheckRunsResponse {
  total_count: number
  check_runs: ApiCheckRun[]
}

interface ApiStatus {
  state: 'error' | 'failure' | 'pending' | 'success'
  context: string
  description: string | null
  target_url: string | null
}

interface ApiCombinedStatus {
  state: 'success' | 'pending' | 'failure'
  statuses: ApiStatus[]
}

interface ApiReview {
  user: { login: string; avatar_url: string }
  state: 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED' | 'DISMISSED' | 'PENDING'
  body: string
  submitted_at: string
  html_url: string
}

function normalizeCheckState(
  status: ApiCheckRun['status'],
  conclusion: ApiCheckRun['conclusion']
): CheckStatus['state'] {
  if (conclusion) {
    switch (conclusion) {
      case 'success':
        return 'success'
      case 'failure':
      case 'timed_out':
      case 'action_required':
      case 'cancelled':
        return 'failure'
      case 'neutral':
        return 'neutral'
      case 'skipped':
        return 'skipped'
      default:
        return 'neutral'
    }
  }
  if (status === 'completed') return 'success'
  return 'pending'
}

function normalizeStatusState(state: ApiStatus['state']): CheckStatus['state'] {
  switch (state) {
    case 'success':
      return 'success'
    case 'failure':
    case 'error':
      return 'failure'
    case 'pending':
      return 'pending'
    default:
      return 'neutral'
  }
}

function computeOverall(checks: CheckStatus[]): PRStatus['checksOverall'] {
  if (checks.length === 0) return 'none'
  if (checks.some((c) => c.state === 'failure' || c.state === 'error')) return 'failure'
  if (checks.some((c) => c.state === 'pending')) return 'pending'
  return 'success'
}

/** Get PR status for the branch checked out in a worktree. Returns null if no PR or no token. */
export async function getPRStatus(worktreePath: string): Promise<PRStatus | null> {
  const token = getCachedToken()
  if (!token) return null

  const repoInfo = await getRepoInfo(worktreePath)
  if (!repoInfo) return null

  const branchName = await getCurrentBranch(worktreePath)
  if (!branchName) return null

  const { owner, repo } = repoInfo

  try {
    // Find the PR(s) for this branch. head filter format: "owner:branch"
    const prList = await githubFetch(
      `https://api.github.com/repos/${owner}/${repo}/pulls?head=${owner}:${encodeURIComponent(branchName)}&state=all&per_page=1`
    ) as ApiPR[]

    if (!Array.isArray(prList) || prList.length === 0) return null

    const pr = prList[0]
    const sha = pr.head.sha

    // Fetch check runs, status contexts, and PR detail (for mergeable) in parallel.
    // The /pulls/{n} endpoint triggers GitHub's background mergeability computation
    // and returns the result if it's ready — otherwise mergeable is null.
    const [checkRunsRes, combinedRes, prDetail, reviewsRes] = await Promise.all([
      githubFetch(`https://api.github.com/repos/${owner}/${repo}/commits/${sha}/check-runs?per_page=100`) as Promise<ApiCheckRunsResponse>,
      githubFetch(`https://api.github.com/repos/${owner}/${repo}/commits/${sha}/status`) as Promise<ApiCombinedStatus>,
      githubFetch(`https://api.github.com/repos/${owner}/${repo}/pulls/${pr.number}`) as Promise<ApiPRDetail>,
      githubFetch(`https://api.github.com/repos/${owner}/${repo}/pulls/${pr.number}/reviews?per_page=100`) as Promise<ApiReview[]>
    ])

    // mergeable_state 'dirty' is the definitive conflict signal. mergeable===false
    // alone can also indicate conflicts. Null/unknown means GitHub hasn't finished
    // computing yet, so we report null and the UI hides the conflict indicator.
    let hasConflict: boolean | null
    if (prDetail.mergeable_state === 'dirty') hasConflict = true
    else if (prDetail.mergeable === false) hasConflict = true
    else if (prDetail.mergeable === true) hasConflict = false
    else hasConflict = null

    const checks: CheckStatus[] = []
    for (const run of checkRunsRes.check_runs || []) {
      checks.push({
        name: run.name,
        state: normalizeCheckState(run.status, run.conclusion),
        description: run.output?.title || '',
        summary: run.output?.summary || undefined,
        detailsUrl: run.html_url || run.details_url || undefined
      })
    }
    for (const s of combinedRes.statuses || []) {
      checks.push({
        name: s.context,
        state: normalizeStatusState(s.state),
        description: s.description || '',
        detailsUrl: s.target_url || undefined
      })
    }

    // Process reviews — keep all reviews, dedupe to latest per user for decision
    const reviews: PRReview[] = (Array.isArray(reviewsRes) ? reviewsRes : [])
      .filter((r) => r.user && r.state !== 'PENDING')
      .map((r) => ({
        user: r.user.login,
        avatarUrl: r.user.avatar_url,
        state: r.state,
        body: r.body || '',
        submittedAt: r.submitted_at,
        htmlUrl: r.html_url
      }))

    // Compute overall review decision from the latest review per user
    const latestByUser = new Map<string, PRReview['state']>()
    for (const r of reviews) {
      latestByUser.set(r.user, r.state)
    }
    const latestStates = [...latestByUser.values()]
    let reviewDecision: PRStatus['reviewDecision'] = 'none'
    if (latestStates.some((s) => s === 'CHANGES_REQUESTED')) reviewDecision = 'changes_requested'
    else if (latestStates.some((s) => s === 'APPROVED')) reviewDecision = 'approved'
    else if (latestStates.length > 0) reviewDecision = 'review_required'

    // Determine PR state
    let state: PRStatus['state']
    if (pr.merged_at) state = 'merged'
    else if (pr.state === 'closed') state = 'closed'
    else if (pr.draft) state = 'draft'
    else state = 'open'

    return {
      number: pr.number,
      title: pr.title,
      state,
      url: pr.html_url,
      branch: branchName,
      checks,
      checksOverall: computeOverall(checks),
      hasConflict,
      reviews,
      reviewDecision,
      additions: prDetail.additions,
      deletions: prDetail.deletions
    }
  } catch (err) {
    log('github', `getPRStatus failed for ${branchName}`, err instanceof Error ? err.message : err)
    return null
  }
}

// ---------------------------------------------------------------------------
// Search API — used by the Inbox view.
//
// Search has its own rate limit (30 req/min authenticated) and a hard 1000
// result cap regardless of pagination. We always sort by updated desc so the
// first page is the most recently active items — what you actually want in
// an inbox. If `total_count > per_page` the UI surfaces a truncation banner.
// ---------------------------------------------------------------------------

interface ApiSearchUser {
  login: string
  avatar_url: string
}

interface ApiSearchLabel {
  name: string
  color: string
}

interface ApiSearchMilestone {
  title: string
  state: 'open' | 'closed'
  number: number
}

interface ApiSearchItem {
  number: number
  title: string
  html_url: string
  state: 'open' | 'closed'
  user: ApiSearchUser | null
  labels: ApiSearchLabel[]
  assignees: ApiSearchUser[] | null
  created_at: string
  updated_at: string
  comments: number
  body: string | null
  milestone: ApiSearchMilestone | null
  /** Present iff this item is a pull request rather than an issue. */
  pull_request?: { url: string }
  /** The repo URL — used to derive owner/repo. Format:
   *  `https://api.github.com/repos/{owner}/{repo}`. */
  repository_url: string
}

interface ApiSearchResult {
  total_count: number
  incomplete_results: boolean
  items: ApiSearchItem[]
}

export interface SearchIssuesItem {
  kind: 'issue' | 'pr'
  owner: string
  repo: string
  number: number
  title: string
  url: string
  state: 'open' | 'closed'
  author: { login: string; avatarUrl: string } | null
  labels: { name: string; color: string }[]
  assignees: { login: string; avatarUrl: string }[]
  createdAt: string
  updatedAt: string
  commentCount: number
  bodyPreview: string | null
  milestone: { title: string; state: 'open' | 'closed'; number: number } | null
}

function parseRepoUrl(repositoryUrl: string): { owner: string; repo: string } | null {
  // Format: https://api.github.com/repos/{owner}/{repo}
  const m = repositoryUrl.match(/\/repos\/([^/]+)\/([^/]+?)\/?$/)
  if (!m) return null
  return { owner: m[1], repo: m[2] }
}

/** Pull out `repo:owner/name` clauses from a search query string. Returns
 *  the de-duplicated list of parsed owner/repo pairs. Bad/non-conforming
 *  values are silently dropped. */
export function parseRepoClauses(query: string): { owner: string; repo: string }[] {
  const re = /\brepo:([^\s]+)/g
  const seen = new Set<string>()
  const out: { owner: string; repo: string }[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(query)) !== null) {
    const parts = m[1].split('/')
    if (parts.length !== 2) continue
    const [owner, repo] = parts
    if (!owner || !repo) continue
    const key = `${owner}/${repo}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ owner, repo })
  }
  return out
}

/** Strip any `milestone:"..."` / `milestone:foo` clause from a query so the
 *  caller can re-attach an exact milestone clause without ANDing two. */
export function stripMilestoneClauses(query: string): string {
  return query
    .replace(/\bmilestone:("[^"]*"|'[^']*'|\S+)/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

/** Run a GitHub issues/PR search. Returns up to 100 most-recently-updated
 *  items plus the total_count GitHub reported (for truncation UI). */
export async function searchIssues(
  query: string
): Promise<{ items: SearchIssuesItem[]; totalCount: number } | null> {
  const token = getCachedToken()
  if (!token) return null

  const url =
    'https://api.github.com/search/issues' +
    `?q=${encodeURIComponent(query)}` +
    '&sort=updated&order=desc&per_page=100'
  try {
    const res = (await githubFetch(url)) as ApiSearchResult
    const items: SearchIssuesItem[] = []
    for (const it of res.items || []) {
      const parsed = parseRepoUrl(it.repository_url)
      if (!parsed) continue
      const kind: 'issue' | 'pr' = it.pull_request ? 'pr' : 'issue'
      items.push({
        kind,
        owner: parsed.owner,
        repo: parsed.repo,
        number: it.number,
        title: it.title,
        url: it.html_url,
        state: it.state,
        author: it.user
          ? { login: it.user.login, avatarUrl: it.user.avatar_url }
          : null,
        labels: (it.labels || []).map((l) => ({ name: l.name, color: l.color })),
        assignees: (it.assignees || []).map((u) => ({
          login: u.login,
          avatarUrl: u.avatar_url
        })),
        createdAt: it.created_at,
        updatedAt: it.updated_at,
        commentCount: it.comments,
        bodyPreview: it.body || null,
        milestone: it.milestone
          ? {
              title: it.milestone.title,
              state: it.milestone.state,
              number: it.milestone.number
            }
          : null
      })
    }
    return { items, totalCount: res.total_count }
  } catch (err) {
    log('github', 'searchIssues failed', err instanceof Error ? err.message : err)
    throw err
  }
}

// ---------------------------------------------------------------------------
// Milestones — used to resolve the InboxQuery.milestoneRegex regex into the
// set of exact milestone names to scope per-call to the search API.
// ---------------------------------------------------------------------------

interface ApiMilestone {
  title: string
  state: 'open' | 'closed'
  number: number
}

export interface MilestoneInfo {
  title: string
  state: 'open' | 'closed'
  number: number
}

/** List milestones for a repo. Paginated up to a generous cap; most repos
 *  have a handful, the unbounded ones are usually closed-milestone history
 *  the user wouldn't reasonably regex-match anyway. */
export async function listMilestones(
  owner: string,
  repo: string
): Promise<MilestoneInfo[]> {
  const token = getCachedToken()
  if (!token) return []
  const out: MilestoneInfo[] = []
  let page = 1
  const maxPages = 5
  while (page <= maxPages) {
    const url = `https://api.github.com/repos/${owner}/${repo}/milestones?state=all&per_page=100&page=${page}`
    let res: ApiMilestone[]
    try {
      res = (await githubFetch(url)) as ApiMilestone[]
    } catch (err) {
      log('github', `listMilestones failed for ${owner}/${repo}`, err instanceof Error ? err.message : err)
      throw err
    }
    if (!Array.isArray(res) || res.length === 0) break
    for (const m of res) {
      out.push({ title: m.title, state: m.state, number: m.number })
    }
    if (res.length < 100) break
    page += 1
  }
  return out
}

// ---------------------------------------------------------------------------
// PR ref lookup — used by the Inbox view's "Create worktree from PR" action.
// Returns just enough information to fetch the right branch and worktree on
// it, without pulling the full PR detail.
// ---------------------------------------------------------------------------

interface ApiPRRepoRef {
  ref: string
  repo: { full_name: string; clone_url: string; ssh_url: string } | null
}

interface ApiPRForRef {
  number: number
  state: 'open' | 'closed'
  draft: boolean
  merged_at: string | null
  head: ApiPRRepoRef
  base: ApiPRRepoRef
}

export interface PRRef {
  number: number
  headRef: string
  headRepoFullName: string
  /** Clone URL for the head repo. Same as the base repo for non-fork PRs. */
  headCloneUrl: string
  baseRef: string
  baseRepoFullName: string
  isFork: boolean
}

interface ApiPRAutoMerge {
  auto_merge: { merge_method?: string } | null
}

/** Lightweight per-PR fetch used to decorate Inbox rows. Returns true when
 *  the PR has auto-merge enabled (which on repos with the GitHub merge
 *  queue corresponds to "queued"). Null = no token or fetch error. */
export async function getPRAutoMerge(
  owner: string,
  repo: string,
  number: number
): Promise<boolean | null> {
  const token = getCachedToken()
  if (!token) return null
  try {
    const pr = (await githubFetch(
      `https://api.github.com/repos/${owner}/${repo}/pulls/${number}`
    )) as ApiPRAutoMerge
    return pr.auto_merge !== null
  } catch (err) {
    log('github', `getPRAutoMerge failed for ${owner}/${repo}#${number}`, err instanceof Error ? err.message : err)
    return null
  }
}

export async function getPRRef(
  owner: string,
  repo: string,
  number: number
): Promise<PRRef | null> {
  const token = getCachedToken()
  if (!token) return null
  try {
    const pr = (await githubFetch(
      `https://api.github.com/repos/${owner}/${repo}/pulls/${number}`
    )) as ApiPRForRef
    const headFullName = pr.head.repo?.full_name ?? `${owner}/${repo}`
    const baseFullName = pr.base.repo?.full_name ?? `${owner}/${repo}`
    return {
      number: pr.number,
      headRef: pr.head.ref,
      headRepoFullName: headFullName,
      headCloneUrl: pr.head.repo?.clone_url ?? `https://github.com/${headFullName}.git`,
      baseRef: pr.base.ref,
      baseRepoFullName: baseFullName,
      isFork: headFullName !== baseFullName
    }
  } catch (err) {
    log('github', `getPRRef failed for ${owner}/${repo}#${number}`, err instanceof Error ? err.message : err)
    return null
  }
}

/** Check whether the authenticated user has starred the repo. */
export async function isRepoStarred(token: string, owner: string, repo: string): Promise<boolean | null> {
  try {
    const res = await fetch(`https://api.github.com/user/starred/${owner}/${repo}`, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'Harness',
        Authorization: `Bearer ${token}`
      }
    })
    if (res.status === 204) return true
    if (res.status === 404) return false
    return null
  } catch {
    return null
  }
}

/** Unstar a repository. Idempotent. */
export async function unstarRepo(token: string, owner: string, repo: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`https://api.github.com/user/starred/${owner}/${repo}`, {
      method: 'DELETE',
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'Harness',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28'
      }
    })
    if (res.status === 204) return { ok: true }
    return { ok: false, error: `${res.status} ${res.statusText}` }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/** Star a repository on behalf of the authenticated user. Idempotent. */
export async function starRepo(token: string, owner: string, repo: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`https://api.github.com/user/starred/${owner}/${repo}`, {
      method: 'PUT',
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'Harness',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Length': '0'
      }
    })
    if (res.status === 204 || res.status === 304) return { ok: true }
    return { ok: false, error: `${res.status} ${res.statusText}` }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/** Test a token by making an authenticated request to /user. Returns the username if valid. */
export async function testToken(token: string): Promise<{ ok: boolean; username?: string; error?: string }> {
  try {
    const res = await fetch('https://api.github.com/user', {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'Harness',
        Authorization: `Bearer ${token}`
      }
    })
    if (!res.ok) {
      return { ok: false, error: `${res.status} ${res.statusText}` }
    }
    const data = await res.json() as { login: string }
    return { ok: true, username: data.login }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}
