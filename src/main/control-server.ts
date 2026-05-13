import { createServer, IncomingMessage, ServerResponse } from 'http'
import { randomBytes } from 'crypto'
import { addWorktree, listWorktrees, defaultWorktreeDir, WorktreeInfo } from './worktree'
import { log } from './debug'
import type { PRStatus } from '../shared/state/prs'

export interface BrowserTabSummary {
  id: string
  url: string
  title: string
}

export interface BrowserQueries {
  listTabsForWorktree: (worktreePath: string) => BrowserTabSummary[]
  getTabWorktree: (tabId: string) => string | null
  getTabUrl: (tabId: string) => string | null
  getTabConsoleLogs: (
    tabId: string
  ) => Array<{ ts: number; level: string; message: string }>
  screenshotTab: (
    tabId: string,
    opts?: { format?: 'jpeg' | 'png'; quality?: number }
  ) => Promise<{ data: string; format: 'jpeg' | 'png' } | null>
  getTabDom: (tabId: string) => Promise<string | null>
  getTabClickables: (tabId: string) => Promise<unknown | null>
  navigateTab: (tabId: string, url: string) => void
  backTab: (tabId: string) => void
  forwardTab: (tabId: string) => void
  reloadTab: (tabId: string) => void
  createTab: (worktreePath: string, url: string) => { id: string; url: string }
  clickTab: (
    tabId: string,
    x: number,
    y: number,
    options?: { button?: 'left' | 'right' | 'middle'; clickCount?: number }
  ) => void
  typeTab: (tabId: string, text: string, key?: string) => void
  scrollTab: (tabId: string, deltaX: number, deltaY: number) => Promise<void>
  showCursor: (tabId: string, x: number, y: number) => Promise<void>
}

export interface ShellTabSummary {
  id: string
  label: string
  command?: string
  cwd?: string
  alive: boolean
}

export interface ReadShellOutputOptions {
  lines: number
  /** Case-insensitive regex. When set, keep only matching lines (plus any
   * requested context) from the output before applying the `lines` cap. */
  match?: string
  /** Lines of context to include before/after each match. Ignored when `match`
   * is not set. */
  context?: number
}

export interface ShellQueries {
  listShellsForWorktree: (worktreePath: string) => ShellTabSummary[]
  getShellWorktree: (shellId: string) => string | null
  readShellOutput: (
    shellId: string,
    opts: ReadShellOutputOptions
  ) => { output: string; matchCount?: number; error?: string }
  createShell: (
    worktreePath: string,
    opts: { command?: string; cwd?: string; label?: string }
  ) => { id: string; label: string }
  killShell: (shellId: string) => void
}

/** Scope derived from the caller's terminal id on every request. The
 * source of truth — env vars injected into the MCP bridge can go stale
 * (teleport sessions, deleted worktrees), so each tool call re-resolves. */
export interface CallerScope {
  terminalId: string
  worktreePath: string
  repoRoot: string
  isMain: boolean
}

export interface BrowserPerms {
  enabled: boolean
  mode: 'view' | 'full'
}

export interface ControlServerDeps {
  getRepoRoots: () => string[]
  getWorktreeBase: () => 'remote' | 'local'
  broadcast: (channel: string, ...args: unknown[]) => void
  /** Returns the caller's current scope, or null if the terminal is not
   * associated with any known worktree (e.g. the worktree was deleted). */
  resolveCallerScope: (terminalId: string) => CallerScope | null
  /** Current browser-tool permissions. Re-read on every request so user
   * toggles take effect mid-session without restarting the bridge. */
  getBrowserPerms: () => BrowserPerms
  /** Read the cached PR status for a worktree path. Returns `null` when
   * the poller has determined there's no PR for the branch, `undefined`
   * when the poller hasn't observed this path yet. */
  getPRStatusForWorktree: (worktreePath: string) => PRStatus | null | undefined
  browser: BrowserQueries
  shell: ShellQueries
}

const FULL_CONTROL_BROWSER_PATHS = new Set([
  '/browser/click',
  '/browser/type',
  '/browser/scroll',
  '/browser/cursor'
])

let serverInfo: { port: number; token: string } | null = null

export function getControlServerInfo(): { port: number; token: string } | null {
  return serverInfo
}

export function startControlServer(deps: ControlServerDeps): Promise<void> {
  return new Promise((resolve, reject) => {
    const token = randomBytes(32).toString('hex')

    const server = createServer((req, res) => {
      handleRequest(req, res, token, deps).catch((err) => {
        log('control', 'handler threw', err instanceof Error ? err.message : String(err))
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }))
        }
      })
    })

    server.listen(0, '127.0.0.1', () => {
      const addr = server.address()
      if (addr && typeof addr === 'object') {
        serverInfo = { port: addr.port, token }
        log('control', `listening on 127.0.0.1:${addr.port}`)
        resolve()
      } else {
        reject(new Error('failed to bind control server'))
      }
    })
    server.on('error', (err) => {
      log('control', 'server error', err.message)
    })
  })
}

function resolveScope(
  req: IncomingMessage,
  deps: ControlServerDeps
): { scope: CallerScope | null; terminalId: string } {
  const terminalId = String(req.headers['x-harness-terminal-id'] || '')
  if (!terminalId) return { scope: null, terminalId: '' }
  return { scope: deps.resolveCallerScope(terminalId), terminalId }
}

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  token: string,
  deps: ControlServerDeps
): Promise<void> {
  const auth = req.headers.authorization
  if (auth !== 'Bearer ' + token) {
    res.writeHead(401)
    res.end('unauthorized')
    return
  }

  const url = new URL(req.url || '/', 'http://127.0.0.1')
  const path = url.pathname

  if (req.method === 'GET' && path === '/health') {
    return sendJson(res, 200, { ok: true })
  }

  // list_repos is workspace-wide for every caller — read-only metadata that
  // helps agents understand the overall harness state.
  if (req.method === 'GET' && path === '/repos') {
    return sendJson(res, 200, { repoRoots: deps.getRepoRoots() })
  }

  // Worktree management tools are workspace-wide for every caller — a
  // feature-worktree session might spin off a new worktree for a related
  // idea, and listing siblings across repos is useful context. Runtime
  // tools (browser, future dev-servers) are the ones that need per-worktree
  // scoping, since those resources physically live inside a single worktree.
  if (req.method === 'GET' && path === '/worktrees') {
    const repoRoot = url.searchParams.get('repoRoot')
    const roots = repoRoot ? [repoRoot] : deps.getRepoRoots()
    const all: WorktreeInfo[] = []
    for (const r of roots) {
      try {
        all.push(...(await listWorktrees(r)))
      } catch (e) {
        log('control', `list worktrees failed for ${r}`, e instanceof Error ? e.message : e)
      }
    }
    return sendJson(res, 200, all)
  }

  if (req.method === 'POST' && path === '/worktrees') {
    const body = await readJson(req)
    let repoRoot = typeof body.repoRoot === 'string' ? body.repoRoot : undefined
    if (!repoRoot) {
      // Prefer the caller's repo when we can infer it — a feature-worktree
      // agent "make a sibling worktree for idea X" reads most naturally
      // without having to pass repoRoot.
      const { scope } = resolveScope(req, deps)
      if (scope) {
        repoRoot = scope.repoRoot
      } else {
        const roots = deps.getRepoRoots()
        if (roots.length === 1) {
          repoRoot = roots[0]
        } else if (roots.length === 0) {
          return sendJson(res, 400, { error: 'no repos open in Harness' })
        } else {
          return sendJson(res, 400, {
            error: 'repoRoot required when multiple repos are open',
            repoRoots: roots
          })
        }
      }
    }

    const branchName = String(body.branchName || '').trim()
    if (!branchName) {
      return sendJson(res, 400, { error: 'branchName required' })
    }
    const wtDir = defaultWorktreeDir(repoRoot)
    const mode = deps.getWorktreeBase()
    const created = await addWorktree(repoRoot, wtDir, branchName, {
      baseBranch: typeof body.baseBranch === 'string' ? body.baseBranch : undefined,
      fetchRemote: !body.baseBranch && mode === 'remote'
    })
    const initialPrompt = typeof body.initialPrompt === 'string' ? body.initialPrompt : undefined
    deps.broadcast('worktrees:externalCreate', { repoRoot, worktree: created, initialPrompt })
    return sendJson(res, 200, created)
  }

  // Browser MCP endpoints. Every call is scoped to the caller's worktree
  // regardless of whether the caller is main or a feature worktree —
  // runtime things (tabs, dev servers) live physically inside one worktree
  // and shouldn't be reachable across boundaries.
  if (path.startsWith('/browser/')) {
    const { scope, terminalId } = resolveScope(req, deps)
    if (!terminalId) {
      return sendJson(res, 400, { error: 'X-Harness-Terminal-Id header required' })
    }
    if (!scope) {
      return sendJson(res, 404, {
        error: 'caller terminal is not associated with a worktree'
      })
    }
    const perms = deps.getBrowserPerms()
    if (!perms.enabled) {
      return sendJson(res, 403, {
        error: 'browser tools are disabled in Harness settings'
      })
    }
    if (perms.mode === 'view' && FULL_CONTROL_BROWSER_PATHS.has(path)) {
      return sendJson(res, 403, {
        error:
          'browser tools are set to View Only in Harness settings — click/type/scroll/cursor are unavailable'
      })
    }
    const callerWorktree = scope.worktreePath

    const assertSameWorktree = (tabId: string): string | null => {
      const wt = deps.browser.getTabWorktree(tabId)
      if (!wt) return 'tab not found'
      if (wt !== callerWorktree) {
        return (
          `cross-worktree access denied: this session is scoped to worktree ${callerWorktree}. ` +
          `Use list_browser_tabs() to see accessible tabs.`
        )
      }
      return null
    }

    if (req.method === 'GET' && path === '/browser/tabs') {
      return sendJson(res, 200, {
        tabs: deps.browser.listTabsForWorktree(callerWorktree)
      })
    }
    if (req.method === 'POST' && path === '/browser/tabs') {
      const body = await readJson(req)
      const url = typeof body.url === 'string' ? body.url : ''
      const created = deps.browser.createTab(callerWorktree, url)
      return sendJson(res, 200, created)
    }

    // Write endpoints read tabId from the JSON body; read endpoints take it
    // as a query param so they can stay GET.
    const body = req.method === 'POST' ? await readJson(req) : {}
    const tabId = String(
      (body.tabId as string | undefined) ?? url.searchParams.get('tabId') ?? ''
    )
    if (!tabId) {
      return sendJson(res, 400, { error: 'tabId required' })
    }
    const bad = assertSameWorktree(tabId)
    if (bad) return sendJson(res, 403, { error: bad })

    if (req.method === 'GET' && path === '/browser/url') {
      return sendJson(res, 200, { url: deps.browser.getTabUrl(tabId) })
    }
    if (req.method === 'GET' && path === '/browser/console') {
      return sendJson(res, 200, { logs: deps.browser.getTabConsoleLogs(tabId) })
    }
    if (req.method === 'GET' && path === '/browser/screenshot') {
      const fmtParam = url.searchParams.get('format')
      const format: 'jpeg' | 'png' = fmtParam === 'png' ? 'png' : 'jpeg'
      const qParam = url.searchParams.get('quality')
      const quality = qParam ? parseInt(qParam, 10) : undefined
      const result = await deps.browser.screenshotTab(tabId, { format, quality })
      return sendJson(res, result ? 200 : 500, {
        data: result?.data,
        format: result?.format,
        mimeType: result ? (result.format === 'png' ? 'image/png' : 'image/jpeg') : undefined,
        // Kept for older MCP bridge versions. New bridges read `data`+`format`.
        pngBase64: result && result.format === 'png' ? result.data : undefined,
        error: result ? undefined : 'capture failed'
      })
    }
    if (req.method === 'GET' && path === '/browser/dom') {
      const dom = await deps.browser.getTabDom(tabId)
      return sendJson(res, dom != null ? 200 : 500, {
        html: dom,
        error: dom != null ? undefined : 'dom read failed'
      })
    }
    if (req.method === 'GET' && path === '/browser/clickables') {
      const data = await deps.browser.getTabClickables(tabId)
      return sendJson(res, data != null ? 200 : 500, {
        snapshot: data,
        error: data != null ? undefined : 'clickables read failed'
      })
    }
    if (req.method === 'POST' && path === '/browser/navigate') {
      const nextUrl = String(body.url || '').trim()
      if (!nextUrl) return sendJson(res, 400, { error: 'url required' })
      deps.browser.navigateTab(tabId, nextUrl)
      return sendJson(res, 200, { ok: true })
    }
    if (req.method === 'POST' && path === '/browser/back') {
      deps.browser.backTab(tabId)
      return sendJson(res, 200, { ok: true })
    }
    if (req.method === 'POST' && path === '/browser/forward') {
      deps.browser.forwardTab(tabId)
      return sendJson(res, 200, { ok: true })
    }
    if (req.method === 'POST' && path === '/browser/reload') {
      deps.browser.reloadTab(tabId)
      return sendJson(res, 200, { ok: true })
    }
    if (req.method === 'POST' && path === '/browser/click') {
      const x = Number(body.x)
      const y = Number(body.y)
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        return sendJson(res, 400, { error: 'x and y (numbers) required' })
      }
      const button = body.button === 'right' || body.button === 'middle' ? body.button : 'left'
      const rawCount = Number(body.clickCount)
      const clickCount = Number.isFinite(rawCount)
        ? Math.max(1, Math.min(3, Math.floor(rawCount)))
        : 1
      deps.browser.clickTab(tabId, x, y, { button, clickCount })
      return sendJson(res, 200, { ok: true })
    }
    if (req.method === 'POST' && path === '/browser/type') {
      const text = typeof body.text === 'string' ? body.text : ''
      const key = typeof body.key === 'string' ? body.key : undefined
      if (!text && !key) {
        return sendJson(res, 400, { error: 'text or key required' })
      }
      deps.browser.typeTab(tabId, text, key)
      return sendJson(res, 200, { ok: true })
    }
    if (req.method === 'POST' && path === '/browser/scroll') {
      const dx = Number(body.deltaX) || 0
      const dy = Number(body.deltaY) || 0
      await deps.browser.scrollTab(tabId, dx, dy)
      return sendJson(res, 200, { ok: true })
    }
    if (req.method === 'POST' && path === '/browser/cursor') {
      const x = Number(body.x)
      const y = Number(body.y)
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        return sendJson(res, 400, { error: 'x and y (numbers) required' })
      }
      await deps.browser.showCursor(tabId, x, y)
      return sendJson(res, 200, { ok: true })
    }

    res.writeHead(404)
    res.end('browser endpoint not found')
    return
  }

  // Shell MCP endpoints. Same worktree-scoping model as /browser/*: agents
  // can spawn shells, read their output, and kill them, but only within
  // their own worktree. Reading another worktree's logs is explicitly
  // denied.
  if (path.startsWith('/shells')) {
    const { scope, terminalId } = resolveScope(req, deps)
    if (!terminalId) {
      return sendJson(res, 400, { error: 'X-Harness-Terminal-Id header required' })
    }
    if (!scope) {
      return sendJson(res, 404, {
        error: 'caller terminal is not associated with a worktree'
      })
    }
    const callerWorktree = scope.worktreePath

    const assertSameWorktree = (shellId: string): string | null => {
      const wt = deps.shell.getShellWorktree(shellId)
      if (!wt) return 'shell not found'
      if (wt !== callerWorktree) {
        return (
          `cross-worktree access denied: this session is scoped to worktree ${callerWorktree}. ` +
          `Use list_shells() to see accessible shells.`
        )
      }
      return null
    }

    if (req.method === 'GET' && path === '/shells') {
      return sendJson(res, 200, {
        shells: deps.shell.listShellsForWorktree(callerWorktree)
      })
    }
    if (req.method === 'POST' && path === '/shells') {
      const body = await readJson(req)
      const command = typeof body.command === 'string' ? body.command.trim() : ''
      const cwd = typeof body.cwd === 'string' ? body.cwd.trim() : ''
      const label = typeof body.label === 'string' ? body.label.trim() : ''
      const created = deps.shell.createShell(callerWorktree, {
        command: command || undefined,
        cwd: cwd || undefined,
        label: label || undefined
      })
      return sendJson(res, 200, created)
    }

    // Remaining routes take a shell_id from body (POST) or query (GET).
    const body = req.method === 'POST' ? await readJson(req) : {}
    const shellId = String(
      (body.shellId as string | undefined) ?? url.searchParams.get('shellId') ?? ''
    )
    if (!shellId) {
      return sendJson(res, 400, { error: 'shellId required' })
    }
    const bad = assertSameWorktree(shellId)
    if (bad) return sendJson(res, 403, { error: bad })

    if (req.method === 'GET' && path === '/shells/output') {
      const linesParam = url.searchParams.get('lines')
      const lines = linesParam
        ? Math.max(1, Math.min(5000, parseInt(linesParam, 10) || 200))
        : 200
      const match = url.searchParams.get('match') || undefined
      const contextParam = url.searchParams.get('context')
      const context = contextParam
        ? Math.max(0, Math.min(20, parseInt(contextParam, 10) || 0))
        : 0
      const result = deps.shell.readShellOutput(shellId, { lines, match, context })
      if (result.error) return sendJson(res, 400, { error: result.error })
      return sendJson(res, 200, result)
    }
    if (req.method === 'POST' && path === '/shells/kill') {
      deps.shell.killShell(shellId)
      return sendJson(res, 200, { ok: true })
    }

    res.writeHead(404)
    res.end('shell endpoint not found')
    return
  }

  // PR status endpoints — read-only reflection of the cached prs slice for
  // the caller's worktree. Lets agents answer "what's failing on my PR?"
  // without shelling out to `gh pr checks`.
  if (req.method === 'GET' && (path === '/pr/status' || path === '/pr/find-checks')) {
    const { scope, terminalId } = resolveScope(req, deps)
    if (!terminalId) {
      return sendJson(res, 400, { error: 'X-Harness-Terminal-Id header required' })
    }
    if (!scope) {
      return sendJson(res, 404, {
        error: 'caller terminal is not associated with a worktree'
      })
    }
    const pr = deps.getPRStatusForWorktree(scope.worktreePath)

    if (path === '/pr/status') {
      if (pr === null) {
        return sendJson(res, 200, {
          state: 'no-pr',
          checks: { total: 0, passing: 0, pending: 0, failing: 0 },
          hasConflict: null
        })
      }
      if (pr === undefined) {
        return sendJson(res, 200, {
          state: 'no-pr',
          checks: { total: 0, passing: 0, pending: 0, failing: 0 },
          hasConflict: null,
          note: 'PR status not yet loaded for this worktree'
        })
      }
      const counts = countChecks(pr.checks)
      let coarse: string
      if (pr.state === 'merged' || pr.state === 'closed' || pr.state === 'draft') {
        coarse = pr.state
      } else if (pr.checks.length === 0) {
        coarse = 'no-checks'
      } else if (counts.failing > 0) {
        coarse = 'failing'
      } else if (counts.pending > 0) {
        coarse = 'pending'
      } else {
        coarse = 'passing'
      }
      const body: Record<string, unknown> = {
        state: coarse,
        prNumber: pr.number,
        prUrl: pr.url,
        checks: counts,
        hasConflict: pr.hasConflict
      }
      if (pr.reviewDecision && pr.reviewDecision !== 'none') {
        body.reviewDecision = pr.reviewDecision
      }
      return sendJson(res, 200, body)
    }

    // /pr/find-checks
    if (!pr) {
      return sendJson(res, 200, [])
    }
    const statusFilter = (url.searchParams.get('status') || 'any').toLowerCase()
    const namePattern = (url.searchParams.get('namePattern') || '').toLowerCase()
    const matches = pr.checks.filter((c) => {
      if (statusFilter !== 'any') {
        const bucket = bucketOf(c.state)
        if (bucket !== statusFilter) return false
      }
      if (namePattern && !c.name.toLowerCase().includes(namePattern)) return false
      return true
    })
    return sendJson(
      res,
      200,
      matches.map((c) => ({
        name: c.name,
        state: c.state,
        description: c.description,
        detailsUrl: c.detailsUrl
      }))
    )
  }

  // /scope — returns the caller's current scope. The MCP bridge calls this
  // once at startup so it can adapt tool descriptions (e.g. signalling
  // "create_worktree defaults to this repo" for feature callers) and filter
  // out browser tools when the user has them disabled or restricted.
  if (req.method === 'GET' && path === '/scope') {
    const { scope, terminalId } = resolveScope(req, deps)
    if (!terminalId) {
      return sendJson(res, 400, { error: 'X-Harness-Terminal-Id header required' })
    }
    return sendJson(res, 200, { scope, browser: deps.getBrowserPerms() })
  }

  res.writeHead(404)
  res.end('not found')
}

function bucketOf(state: PRStatus['checks'][number]['state']): 'passing' | 'pending' | 'failing' {
  if (state === 'success' || state === 'neutral' || state === 'skipped') return 'passing'
  if (state === 'pending') return 'pending'
  return 'failing'
}

function countChecks(
  checks: PRStatus['checks']
): { total: number; passing: number; pending: number; failing: number } {
  let passing = 0
  let pending = 0
  let failing = 0
  for (const c of checks) {
    const b = bucketOf(c.state)
    if (b === 'passing') passing++
    else if (b === 'pending') pending++
    else failing++
  }
  return { total: checks.length, passing, pending, failing }
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(body))
}

function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => {
      if (chunks.length === 0) return resolve({})
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf-8')))
      } catch (e) {
        reject(e)
      }
    })
    req.on('error', reject)
  })
}
