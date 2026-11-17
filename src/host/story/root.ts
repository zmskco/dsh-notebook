/**
 * Which directory a call's notes live in.
 *
 * Notes live **in the workspace the operator opened**: the plugin takes the
 * calling Session's immutable cwd and treats it as the root, so every write it
 * makes lands in a directory that Session's own sandbox policy already permits —
 * and so does every write the *model* makes with its own `write`/`edit` tools or
 * a `pwsh` script, which are bounded by that same workspace rather than by
 * anything this plugin declares.
 *
 * That is the whole permission story, and it is why there is no `rootDir` any
 * more. There used to be one, and it could not be honoured: the panel's requests
 * always carry a live Session, so the root was the workspace no matter what the
 * profile pinned — while `op=state` still reported the pin as the rule that had
 * chosen it. A configuration knob that changes nothing but the log line is worse
 * than no knob, and the arrangement it promised was one nobody should want: a
 * second root only this plugin can write, where the model's own tools are
 * refused by the very boundary they are confined to.
 *
 * To put a library somewhere else, open that directory as the workspace. One
 * directory, one decision, made by the person who opened it.
 *
 * With no live Session — a scripted caller, or the instant before the page binds
 * — the activation fallback is used; see `bootstrap.ts` for how it is chosen.
 *
 * `header.cwd` is preferred over `workingDirectory.get` on purpose. The former
 * is what the operator opened and what `sandboxPolicy.resolve` treats as the
 * Session's write boundary; the latter follows an in-session `cd`, which would
 * silently move every file the plugin is reading.
 *
 * @module notebook/story/root
 */
import type { AgentsService, FsService, Logger, SandboxPolicyService } from '../dsh.js'
import { ProjectStore } from './project.js'
import { storyWritePolicy, type LiveSession } from './sandbox.js'

/**
 * The root one call resolved to, and which rule chose it.
 */
export interface StoryRoot {
  /** Absolute directory holding the notes; the panel's tree is rooted here. */
  dir: string
  /**
   * `workspace` — the calling Session's cwd itself.
   * `fallback` — the activation default, used when there is no Session.
   */
  source: 'workspace' | 'fallback'
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
 * Declared once here and used by every surface that needs it — the control plane
 * and the sandbox assessment — so all of them agree on the shape.
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
 * Decide which directory a call's notes live in.
 *
 * There is nothing to choose between: a live Session *is* the root.
 * @param fallbackRoot - the activation default, for a caller with no Session.
 * @param workspace - the calling Session's workspace, when known.
 * @returns the root and the rule that chose it.
 */
export function storyRootFor(fallbackRoot: string, workspace: string | undefined): StoryRoot {
  // The path is used verbatim: a trailing space is legal input, and trimming the
  // value would resolve a directory the operator did not open. Only the
  // emptiness test looks at the trimmed form.
  if (workspace !== undefined && workspace.trim().length > 0) return { dir: workspace, source: 'workspace' }
  return { dir: fallbackRoot, source: 'fallback' }
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
 * @param deps - filesystem, the session-less fallback root, sandbox policy, agent registry, logger.
 * @returns a resolver from an optional Session id to that call's store and root.
 */
export function createRootResolver(deps: {
  fs: FsService
  /** Absolute directory a caller with no Session falls back to. */
  fallbackRoot: string
  policy: SandboxPolicyService | undefined
  agents: AgentsService | undefined
  log: Logger
}): RootResolver {
  const cache = new Map<string, ProjectStore>()
  return (sessionId) => {
    const session = liveSession(deps.agents, sessionId)
    const root = storyRootFor(deps.fallbackRoot, session?.header.cwd)
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
