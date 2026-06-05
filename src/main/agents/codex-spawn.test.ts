import { describe, it, expect } from 'vitest'
import { buildSpawnArgs } from './codex'

describe('codex buildSpawnArgs', () => {
  const base = { command: 'codex', cwd: '/tmp/test' }

  it('blank: no resume/fork when the session id has no recorded file', () => {
    // No session file on disk for this id, so sessionFileExists is false.
    const result = buildSpawnArgs({ ...base, sessionId: 'fresh-id' })
    expect(result).not.toContain('resume')
    expect(result).not.toContain('fork')
  })

  it('fork: `codex fork <src>`, ignoring any sessionId', () => {
    const result = buildSpawnArgs({ ...base, sessionId: 'tab-id', forkFromSessionId: 'src-id' })
    expect(result).toContain('fork src-id')
    expect(result).not.toContain('resume')
  })
})

describe('codex buildSpawnArgs with harnessControl', () => {
  it('emits -c mcp_servers.harness-control.* with literal values', () => {
    const cmd = buildSpawnArgs({
      command: 'codex',
      cwd: '/wt',
      harnessControl: {
        execPath: '/abs/Electron',
        bridgePath: '/abs/bridge.js',
        port: 9999,
        token: 'secret',
        terminalId: 'term-1',
        workspaceId: '/wt',
        repoRoot: '/repo',
        isMain: true
      }
    })
    console.log('SPAWN:', cmd)
    expect(cmd).toContain('-c')
    expect(cmd).toContain('mcp_servers.harness-control.command')
    expect(cmd).toContain('"/abs/Electron"')
    expect(cmd).toContain('"/abs/bridge.js"')
    expect(cmd).toContain('HARNESS_PORT="9999"')
    expect(cmd).toContain('HARNESS_TOKEN="secret"')
    expect(cmd).toContain('HARNESS_TERMINAL_ID="term-1"')
    expect(cmd).toContain('HARNESS_IS_MAIN="1"')
  })
})
