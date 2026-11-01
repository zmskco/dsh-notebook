/**
 * The plugin's write boundary, and the two ways a workspace can disagree with
 * it.
 *
 * Every write this plugin makes — from the panel and from a model tool call
 * alike, it is the same code path — goes through `ctx.fs` with an explicit
 * policy. That matters because `fs-sandbox` otherwise calls
 * `ctx.sandboxPolicy.resolve()` with **no session**: a call with no policy of
 * its own is judged against the *deployment* fallback, `defaultMode` plus
 * `workspaceRoot` (whose own default is wherever dsh was launched), never
 * against the story root it is actually writing to.
 *
 * So {@link storyWritePolicy} states the boundary per call: the story root, which
 * is `<workspace>/novels` under the Session that made the call (`root.ts`).
 * Nothing is widened by that — the root is inside the Session's own workspace
 * unless a profile pinned one elsewhere — and `fs-sandbox` still re-canonicalizes
 * the target and enforces containment against it, which is the check that
 * actually stops a path escaping.
 *
 * The **mode** is not invented either: it comes from `resolve({ session })`,
 * the same call `fs-sandbox` makes, so a Session the operator has switched to
 * `danger-full-access` (or a deployment still under `read-only`) behaves here
 * exactly as it does for the model's own `write`/`edit` and `pwsh`.
 *
 * What is left to report is therefore not "can this plugin write" — it can, into
 * its own shelf — but the two arrangements where the *other* writer cannot:
 * a `read-only` deployment, where nothing may write at all, and a pinned
 * `rootDir` outside the Session's workspace, where the plugin's own writes
 * succeed but the model's tools and scripts are refused by the very same
 * boundary they are confined to.
 *
 * @module notebook/story/sandbox
 */
import { homedir } from 'node:os'
import { join, resolve, sep } from 'node:path'
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
  /**
   * Why a write is expected to fail, or why it will succeed while the model's
   * own tools will not, in the user's terms.
   */
  reason?: 'read-only' | 'outside-workspace'
  /** The Session workspace the root was compared against, when there was one. */
  sessionWorkspace?: string
}

/**
 * Whether `child` is `parent` or lives under it.
 *
 * Advisory only — this decides what to *say*, while `fs-sandbox` does the
 * canonical containment check that decides what happens. Windows paths are
 * compared case-insensitively because the filesystem is.
 */
function isUnder(child: string, parent: string): boolean {
  const outer = resolve(parent)
  const inner = resolve(child)
  const fold = (value: string): string => (process.platform === 'win32' ? value.toLowerCase() : value)
  const outerKey = fold(outer)
  const innerKey = fold(inner)
  if (innerKey === outerKey) return true
  return innerKey.startsWith(outerKey.endsWith(sep) ? outerKey : outerKey + sep)
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
 * The policy to stamp on every write of one story root.
 *
 * The mode is the caller's own; the boundary becomes the directory the stories
 * actually live in.
 * @param rootDir - the resolved absolute story root for this call.
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
 * Decide whether a write to `rootDir` should be expected to work, and warn when
 * the model's own tools will not be able to follow.
 *
 * Advisory only: the caller reports this and uses it to explain a failure, but
 * still attempts the write, because refusing a write that would have succeeded
 * is worse than a warning that turns out to be unnecessary.
 * @param rootDir - the resolved absolute story root for this call.
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
  const workspace = session?.header.cwd
  if (workspace !== undefined && workspace.trim().length > 0 && !isUnder(rootDir, workspace.trim())) {
    // Not a refusal: the plugin stamps its own boundary and writes here happily.
    // It is the model's half that cannot follow, and silence about that is how a
    // half-working setup looks like a working one.
    return {
      writable: true,
      mode,
      workspaceRoot: rootDir,
      reason: 'outside-workspace',
      sessionWorkspace: workspace.trim(),
    }
  }
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
 * The mode is the only knob that can be turned from here — the story boundary
 * follows the call, so the remedy for a *read-only* deployment is a mode change,
 * not a directory move. A pinned `rootDir` is a different failure (see
 * {@link outsideWorkspaceGuidance}) and is fixed by editing that pin. The YAML is
 * spelled out rather than described because `config` in a Loader patch is
 * replaced wholesale, never deep-merged — an entry that set only `mode` would
 * reset `workspaceRoot` to `process.cwd()`.
 * @param rootDir - the root the refused call resolved to.
 * @param access - the assessment for that root.
 * @returns a multi-line message suitable for the panel and for a tool result.
 */
function readOnlyGuidance(rootDir: string, access: WriteAccess): string {
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

/**
 * Explain a root that sits outside the open workspace.
 *
 * Nothing here is broken from the plugin's side — which is exactly why it has to
 * be said out loud, in both directions: what still works, and what does not.
 * @param rootDir - the root the call resolved to.
 * @param access - the assessment for that root.
 * @returns a multi-line message suitable for the panel and for a tool result.
 */
function outsideWorkspaceGuidance(rootDir: string, access: WriteAccess): string {
  const workspace = access.sessionWorkspace ?? '当前工作区'
  return [
    `目录 ${rootDir} 不在当前工作区 ${workspace} 之内（由 profile 里的 rootDir 固定）。`,
    '',
    '面板照常读写：插件给每次写入盖的边界就是这个目录本身。',
    '但模型自己的 write/edit 工具，以及 pwsh / python 脚本，边界是本会话的工作区，',
    '在这里会被沙箱拒绝（读不受影响）。',
    '',
    '两种改法，任选其一：',
    `  · 去掉 profile 里的 rootDir，笔记本就落在工作区 ${workspace}；`,
    '  · 或者把这个目录本身作为工作区打开。',
  ].join('\n')
}

/**
 * The remedy text for a root that cannot be written, or that only this plugin
 * can write.
 * @param rootDir - the story root the call resolved to.
 * @param access - the assessment for that root.
 * @returns a multi-line message, or `null` when there is nothing to say.
 */
export function writeAccessGuidance(rootDir: string, access: WriteAccess): string | null {
  if (access.reason === 'read-only') return readOnlyGuidance(rootDir, access)
  if (access.reason === 'outside-workspace') return outsideWorkspaceGuidance(rootDir, access)
  return null
}
