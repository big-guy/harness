import type { ContentBreakdown } from './state/costs'

export interface SessionCostSummary {
  sessionId: string
  projectPath: string
  totalCostUsd: number
  model: string | null
  firstAt: number
  lastAt: number
  turns: number
  breakdown: ContentBreakdown
}

export type SubscriptionTier = 'pro' | 'max-5x' | 'max-20x' | 'team' | 'enterprise' | 'unknown'

export interface ClaudeAuthInfo {
  loggedIn: boolean
  email: string | null
  organizationType: string | null
  rateLimitTier: string | null
  tier: SubscriptionTier | null
  monthlyUsd: number | null
  /** Human-readable org name from ~/.claude.json's oauthAccount.
   *  Falls back to null when missing. Used as a display fallback when
   *  the user's email isn't available. */
  organizationName: string | null
  /** Account UUID from ~/.claude.json's oauthAccount. Last-resort
   *  identifier when neither email nor org name is present. */
  accountUuid: string | null
}
