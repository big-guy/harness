// Reads the user's Claude Code auth state from `<claude-config-dir>/.claude.json`
// — the client-side mirror of the OAuth account info that
// `claude auth status` surfaces. Used by the Costs tab to show
// subscription-aware copy ("you're on Max 20x, this would have cost $X
// on the API") and by the Cost pane to show the active account at the
// top.
//
// By default `<claude-config-dir>` is `~/.claude`. Worktrees in a repo
// whose `.harness.json` sets `claudeConfigDir` override this — pass the
// repo's effective dir via `opts.configDir` to read from there. Cache
// is keyed by resolved path so callers in different repos don't trample
// each other.
//
// We deliberately avoid spawning `claude auth status` here:
//   1. Subprocess + login-shell wrap is slow on cold start.
//   2. ~/.claude.json carries the rate-limit-tier (5x vs 20x), which
//      `claude auth status`'s output doesn't break out.
//   3. No keychain access prompt — we never touch the credentials JSON
//      stored in the macOS keychain, only the local config mirror.

import { readFile } from 'fs/promises'
import { homedir } from 'os'
import { isAbsolute, join } from 'path'
import type { ClaudeAuthInfo, SubscriptionTier } from '../shared/cost-summary'

export type { ClaudeAuthInfo, SubscriptionTier }

const TIER_PRICING: Record<SubscriptionTier, number | null> = {
  pro: 20,
  'max-5x': 100,
  'max-20x': 200,
  team: null,
  enterprise: null,
  unknown: null
}

const cache = new Map<string, ClaudeAuthInfo>()

export async function getClaudeAuthStatus(
  opts: { force?: boolean; configDir?: string } = {}
): Promise<ClaudeAuthInfo> {
  const path = resolveAuthPath(opts.configDir)
  if (!opts.force) {
    const hit = cache.get(path)
    if (hit) return hit
  }
  const fresh = await readAuthStatus(path)
  cache.set(path, fresh)
  return fresh
}

function resolveAuthPath(configDir?: string): string {
  if (configDir && configDir.trim()) {
    const dir = configDir.trim()
    const abs = isAbsolute(dir)
      ? dir
      : dir.startsWith('~')
        ? join(homedir(), dir.slice(1))
        : join(homedir(), dir)
    return join(abs, '.claude.json')
  }
  return join(homedir(), '.claude.json')
}

async function readAuthStatus(path: string): Promise<ClaudeAuthInfo> {
  let raw: string
  try {
    raw = await readFile(path, 'utf-8')
  } catch {
    return notLoggedIn()
  }
  let obj: Record<string, unknown>
  try {
    obj = JSON.parse(raw) as Record<string, unknown>
  } catch {
    return notLoggedIn()
  }
  const oauth = obj.oauthAccount as Record<string, unknown> | undefined
  if (!oauth) return notLoggedIn()
  const orgType = typeof oauth.organizationType === 'string' ? oauth.organizationType : null
  const rateLimit =
    typeof oauth.organizationRateLimitTier === 'string'
      ? oauth.organizationRateLimitTier
      : null
  const email = typeof oauth.emailAddress === 'string' ? oauth.emailAddress : null
  const organizationName =
    typeof oauth.organizationName === 'string' ? oauth.organizationName : null
  const accountUuid = typeof oauth.accountUuid === 'string' ? oauth.accountUuid : null
  const tier = deriveTier(orgType, rateLimit)
  return {
    loggedIn: true,
    email,
    organizationType: orgType,
    rateLimitTier: rateLimit,
    tier,
    monthlyUsd: tier ? TIER_PRICING[tier] : null,
    organizationName,
    accountUuid
  }
}

function deriveTier(
  orgType: string | null,
  rateLimitTier: string | null
): SubscriptionTier | null {
  if (!orgType) return null
  if (orgType === 'claude_pro') return 'pro'
  if (orgType === 'claude_max') {
    if (rateLimitTier?.includes('20x')) return 'max-20x'
    if (rateLimitTier?.includes('5x')) return 'max-5x'
    return 'unknown'
  }
  if (orgType === 'claude_team' || orgType.includes('team')) return 'team'
  if (orgType.includes('enterprise')) return 'enterprise'
  return 'unknown'
}

function notLoggedIn(): ClaudeAuthInfo {
  return {
    loggedIn: false,
    email: null,
    organizationType: null,
    rateLimitTier: null,
    tier: null,
    monthlyUsd: null,
    organizationName: null,
    accountUuid: null
  }
}
