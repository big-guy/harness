import type { AgentKind } from '../../shared/state/terminals'
import * as claude from './claude'
import * as codex from './codex'

export type { AgentKind }

export interface AgentSpawnOpts {
  command: string
  cwd: string
  sessionId?: string
  /** Fork source: when set, the agent resumes this session but branches it
   *  into a brand-new one (Claude `--fork-session`, Codex `fork <id>`),
   *  leaving the source untouched. Takes precedence over sessionId. */
  forkFromSessionId?: string
  initialPrompt?: string
  teleportSessionId?: string
  sessionName?: string
  model?: string | null
  systemPrompt?: string
  tuiFullscreen?: boolean
  /** Resolved per-repo Claude home directory (CLAUDE_CONFIG_DIR) for
   *  this worktree, or empty/undefined for the default `~/.claude`. The
   *  spawn-args builder uses it to probe the correct
   *  `<configDir>/projects/…` transcript location when deciding
   *  `--resume` vs `--session-id`; without it a custom-home session
   *  misdetects as fresh and Claude rejects the existing id on restore. */
  configDir?: string
  /** Harness-control MCP bridge runtime info. The Codex agent injects
   *  this as `-c mcp_servers.harness-control.*` overrides at spawn
   *  time because Codex's `.mcp.json` does no interpolation (see
   *  src/main/codex-plugin.ts:neutralizeCachedMcpJson). Claude consumes
   *  the same data via the plugin's `.mcp.json` template; populated
   *  for both agent kinds but only Codex reads it through this path. */
  harnessControl?: {
    execPath: string
    bridgePath: string
    port: number
    token: string
    terminalId: string
    workspaceId?: string
    repoRoot?: string
    isMain?: boolean
  }
}

export interface AgentModule {
  hookEvents: string[]
  defaultCommand: string
  /** If true, Harness generates the session ID and passes it to the agent
   * CLI on first spawn (e.g. Claude's --session-id). If false, the agent
   * assigns its own ID and Harness discovers it from the first hook event. */
  assignsSessionId: boolean
  /** Migration: strip legacy Harness entries from a single worktree's
   *  per-worktree settings file. Returns true if the file was modified.
   *  Claude wrote per-worktree entries before the global-install era;
   *  Codex has its own equivalent. Used by the boot migration sweep. */
  stripHooksFromWorktree(worktreePath: string): boolean
  sessionFileExists(cwd: string, sessionId: string, configDir?: string): boolean
  latestSessionId(cwd: string, configDir?: string): string | null
  /** This agent's recorded sessions for a worktree, newest first by mtime.
   *  Powers "resume the last known session" and excludes already-open ids
   *  at the call site. */
  listSessions(cwd: string, configDir?: string): Array<{ sessionId: string; mtimeMs: number }>
  buildSpawnArgs(opts: AgentSpawnOpts): string
}

const agents: Record<AgentKind, AgentModule> = { claude, codex }

export function getAgent(kind: AgentKind): AgentModule {
  return agents[kind]
}
