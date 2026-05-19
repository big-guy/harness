import { execFile } from 'child_process'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)

/** Read `remote.origin.url` for a tracked repo root and parse it to
 *  owner/repo. Returns null on missing remote, parse failure, or any
 *  git error (the caller's repo is just skipped). */
export async function getRepoOriginInfo(
  repoRoot: string
): Promise<{ owner: string; repo: string } | null> {
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['config', '--get', 'remote.origin.url'],
      { cwd: repoRoot }
    )
    const url = stdout.trim()
    // SSH (git@host:owner/repo[.git]) or HTTPS (https://host/owner/repo[.git])
    const m = url.match(/[:/]([^/:]+)\/([^/]+?)(?:\.git)?$/)
    if (!m) return null
    return { owner: m[1], repo: m[2] }
  } catch {
    return null
  }
}
