/**
 * The plugin's write boundary.
 *
 * Every write this plugin makes — from the panel, and from the model going
 * through the same store — goes through `ctx.fs` with an explicit policy. That
 * matters because `fs-sandbox` otherwise calls `ctx.sandboxPolicy.resolve()` with
 * **no session**: a call with no policy of its own is judged against the
 * *deployment* fallback, `defaultMode` plus `workspaceRoot` (whose own default is
 * wherever dsh was launched), never against the workspace it is actually writing
 * to.
 *
 * So {@link storyWritePolicy} states the boundary per call: the resolved root,
 * which is the calling Session's own workspace. Nothing is widened by that — the
 * boundary the plugin stamps is the boundary the Session already has — and
 * `fs-sandbox` still re-canonicalizes the target and enforces containment against
 * it, which is the check that actually stops a path escaping.
 *
 * The **mode** is not invented either: it comes from `resolve({ session })`, the
 * same call `fs-sandbox` makes, so a Session the operator has switched to
 * `danger-full-access` (or a deployment still under `read-only`) behaves here
 * exactly as it does for the model's own `write`/`edit` and `pwsh`.
 *
 * What is left to report is therefore a single arrangement: a `read-only`
 * deployment, where nothing may write at all — the panel and the model's tools
 * alike, because they are the same boundary.
 *
 * @module notebook/story/sandbox
 */
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { AgentHandle, SandboxExecutionPolicy, SandboxMode, SandboxPolicyService } from '../dsh.js'

/** One live Session, as much of it as a policy decision needs. */
export type LiveSession = AgentHandle['session']

/** What the plugin can say about writing to its root before trying. */
export interface WriteAccess {
  /** Whether this plugin's own writes are expected to succeed. */
  writable: boolean
  /** The boundary the plugin's own writes are confined to, when one applies. */
  workspaceRoot?: string
  mode?: SandboxMode
  /** Why a write is expected to fail, in the user's terms. */
  reason?: 'read-only'
}

/**
 * The mode one call runs under, resolved exactly as `fs-sandbox` resolves it.
 *
 * A Session carries its own mode log (`sandbox/mode`), so the panel must ask
 * about the Session rather than read `defaultMode`: the operator can switch a
 * Session to `danger-full-access` while the deployment stays `read-only`, and a
 * panel disagreeing with the tools about that is a lie in the UI.
 * @param policy - the sandbox policy service.
 * @param session - the calling Session, when the caller named one.
 * @returns the effective mode for that call.
 */
export function callMode(policy: SandboxPolicyService, session: LiveSession | undefined): SandboxMode {
  return policy.resolve(session === undefined ? {} : { session }).mode
}

/**
 * The policy to stamp on every write of one root.
 *
 * The mode is the caller's own; the boundary is the directory the notes actually
 * live in, which is that Session's workspace.
 * @param rootDir - the resolved absolute root for this call.
 * @param policy - the sandbox policy service, when the profile has one.
 * @param session - the calling Session, when the caller named one.
 * @returns the per-call policy, or `undefined` when nothing confines this
 *   profile's writes and there is therefore nothing to stamp.
 */
export function storyWritePolicy(
  rootDir: string,
  policy: SandboxPolicyService | undefined,
  session?: LiveSession,
): SandboxExecutionPolicy | undefined {
  if (policy === undefined) return undefined
  return { mode: callMode(policy, session), workspaceRoot: rootDir }
}

/**
 * Decide whether a write to `rootDir` should be expected to work.
 *
 * Advisory only: the caller reports this and uses it to explain a failure, but
 * still attempts the write, because refusing a write that would have succeeded
 * is worse than a warning that turns out to be unnecessary.
 * @param rootDir - the resolved absolute root for this call.
 * @param policy - the sandbox policy service, when this profile has one.
 * @param session - the calling Session, when the caller named one.
 * @returns the assessment shown in the panel and used to explain failures.
 */
export function assessWriteAccess(
  rootDir: string,
  policy: SandboxPolicyService | undefined,
  session?: LiveSession,
): WriteAccess {
  if (policy === undefined) return { writable: true }
  const mode = callMode(policy, session)
  if (mode === 'read-only') return { writable: false, mode, workspaceRoot: rootDir, reason: 'read-only' }
  return { writable: true, mode, workspaceRoot: rootDir }
}

/** The profile patch file a user edits to change the sandbox mode. */
export function profilePatchPath(): string {
  const home = process.env.DSH_HOME?.trim()
  const profile = process.env.DSH_PROFILE?.trim() || 'web'
  const base = home !== undefined && home.length > 0 ? home : join(homedir(), '.dsh')
  return join(base, 'profiles', profile, 'cordis.patch.yml')
}

/**
 * Explain a read-only deployment and give the exact edit that lifts it.
 *
 * The mode is the only knob that can be turned from here — the root follows the
 * calling Session, so the remedy for a *read-only* deployment is a mode change,
 * not a directory move. The YAML is spelled out rather than described because
 * `config` in a Loader patch is replaced wholesale, never deep-merged — an entry
 * that set only `mode` would reset `workspaceRoot` to `process.cwd()`.
 * @param rootDir - the root the refused call resolved to.
 * @param access - the assessment for that root.
 * @returns a multi-line message suitable for the panel and for a tool result.
 */
export function writeAccessGuidance(rootDir: string, access: WriteAccess): string | null {
  if (access.reason !== 'read-only') return null
  const patch = profilePatchPath()
  return [
    `目录 ${rootDir} 不可写：当前部署的文件策略是 read-only，插件的每一次写入都会被拒绝。`,
    '',
    `在 ${patch} 里放行（config 是整体替换，所以要连 mode 一起写）：`,
    '',
    '  - id: sandbox-policy',
    '    config:',
    "      mode: !!js process.env.DSH_PERMISSION_MODE ?? 'workspace-write'",
    `      workspaceRoot: ${access.workspaceRoot ?? rootDir}`,
  ].join('\n')
}
