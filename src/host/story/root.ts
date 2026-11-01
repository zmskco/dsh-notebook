/**
 * Which directory a call's stories live in.
 *
 * Stories live **in the workspace the operator opened**: the plugin takes the
 * calling Session's immutable cwd and treats it as the root, so every write it
 * makes lands in a directory that Session's own sandbox policy already permits —
 * and so does every write the *model* makes with its own `write`/`edit` tools or
 * a `pwsh` script, which are bounded by that same workspace rather than by
 * anything this plugin declares.
 *
 * That is the whole permission story: one boundary, chosen once, by the person
 * who opened the workspace. There is no shelf directory any more — a `novels/`
 * the plugin invented was a second root to explain, and the panel's tree was
 * already the workspace; a story is simply a folder in it.
 *
 * An explicit `rootDir` in the profile row still wins, because a deployment may
 * pin one library that several workspaces share — that is now the *only* way to
 * put stories outside the open workspace, and it is a configuration edit rather
 * than a panel action. With neither a live Session nor a pin, the
 * caller-supplied fallback is used: the sandbox-aware default computed at
 * activation, which is what a session-less panel sees.
 *
 * `header.cwd` is preferred over `workingDirectory.get` on purpose. The former
 * is what the operator opened and what `sandboxPolicy.resolve` treats as the
 * Session's write boundary; the latter follows an in-session `cd`, which would
 * silently move every story the plugin is reading.
 *
 * @module notebook/story/root
 */
import type { AgentsService, FsService, Logger, SandboxPolicyService } from '../dsh.js'
import { ProjectStore } from './project.js'
import { storyWritePolicy, type LiveSession } from './sandbox.js'
import type { NotebookConfig } from '../types.js'

/**
 * The story root one call resolved to, and which rule chose it.
 */
export interface StoryRoot {
  /** Absolute directory holding the stories; each child directory is one. */
  dir: string
  /**
   * `override` — pinned by the profile row's `rootDir`.
   * `workspace` — the calling Session's cwd itself.
   * `fallback` — the activation default, used when neither exists.
   */
  source: 'override' | 'workspace' | 'fallback'
}

/** One resolved call target: the store to use, the root it reads, and the Session. */
export interface ResolvedRoot {
  store: ProjectStore
  root: StoryRoot
  /**
   * The calling Session itself, when it is live.
   *
   * Returned alongside the root so the caller can hand the *same* Session to
   * `sandboxPolicy.resolve` that this resolver used to find the workspace: the
   * panel's own assessment and the model's tools must not disagree about which
   * boundary applies.
   */
  session: LiveSession | undefined
}

/**
 * Resolve one call's target.
 *
 * Declared once here and used by every surface that needs it — the control
 * plane, the media route and the model tools — so all three agree on the shape.
 * @param sessionId - the calling Session, when the caller knows it.
 * @returns that call's store, root and Session.
 */
export type RootResolver = (sessionId?: string) => ResolvedRoot

/**
 * The live Session behind one id, when there is one.
 * @param agents - the agent registry, when this profile has one.
 * @param sessionId - the calling Session, when the caller knows it.
 * @returns the Session, or `undefined` when it cannot be known.
 */
function liveSession(agents: AgentsService | undefined, sessionId: string | undefined): LiveSession | undefined {
  if (agents === undefined || sessionId === undefined) return undefined
  return agents.get(sessionId)?.session
}

/**
 * Decide which directory a call's stories live in.
 * @param config - the validated configuration; its `rootDir` is already absolute.
 * @param workspace - the calling Session's workspace, when known.
 * @returns the root and the rule that chose it.
 */
export function storyRootFor(config: NotebookConfig, workspace: string | undefined): StoryRoot {
  if (config.rootDirOverride) return { dir: config.rootDir, source: 'override' }
  if (workspace !== undefined) return { dir: workspace, source: 'workspace' }
  return { dir: config.rootDir, source: 'fallback' }
}

/** Roots kept as live stores; a session beyond this evicts the least recently added. */
const MAX_CACHED_ROOTS = 8

/**
 * Build the per-call root resolver.
 *
 * One store per (root, mode), cached because every call in a Session resolves to
 * the same root and a store holds nothing but its own listing cache. The mode is
 * part of the key rather than fixed at activation because a Session's mode can be
 * switched while the plugin is serving it, and the write policy was stamped with
 * the old one — a second store costs a directory listing, a stale mode costs a
 * write that should have been allowed.
 * @param deps - filesystem, configuration, sandbox policy, agent registry, logger.
 * @returns a resolver from an optional Session id to that call's store and root.
 */
export function createRootResolver(deps: {
  fs: FsService
  config: NotebookConfig
  policy: SandboxPolicyService | undefined
  agents: AgentsService | undefined
  log: Logger
}): RootResolver {
  const cache = new Map<string, ProjectStore>()
  return (sessionId) => {
    const session = liveSession(deps.agents, sessionId)
    const root = storyRootFor(deps.config, session?.header.cwd)
    const writePolicy = storyWritePolicy(root.dir, deps.policy, session)
    const key = `${root.dir}\u0000${writePolicy?.mode ?? ''}`
    let store = cache.get(key)
    if (store === undefined) {
      store = new ProjectStore(deps.fs, root.dir, deps.log, writePolicy)
      cache.set(key, store)
      if (cache.size > MAX_CACHED_ROOTS) {
        const oldest = cache.keys().next().value
        if (oldest !== undefined) cache.delete(oldest)
      }
    }
    return { store, root, session }
  }
}
