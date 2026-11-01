/**
 * The workspace the panel's tree is rooted at.
 *
 * The directory column used to browse `novels/` — a shelf of stories — and a
 * switcher above it chose which story was open. It now shows **the workspace the
 * operator opened**: the files the Session can already see and write, with the
 * story layer left to the model's tools. That removes the last piece of state the
 * page had to remember (which book) and one whole failure mode (a remembered book
 * that is gone).
 *
 * The store is built over the workspace itself, so its paths are project-relative
 * to the workspace and every call is containment-checked against it. The write
 * policy is stamped with the workspace as the boundary — the same boundary the
 * operator's sandbox resolves — so a write carries the arrangement it was made
 * under rather than the deployment default.
 *
 * @module notebook/story/workspace
 */
import type { FsService, Logger, SandboxPolicyService } from '../dsh.js'
import { ProjectStore } from './project.js'
import { storyWritePolicy, type LiveSession } from './sandbox.js'

/**
 * The directory the panel's tree shows.
 *
 * A live Session knows it exactly (`header.cwd`, the folder the operator opened).
 * Without one — a scripted caller, or the moment before the page binds — the
 * session-less fallback root *is* the workspace, so it is used as is.
 * @param session - the calling Session, when live.
 * @param fallbackRoot - the store root resolved for this call.
 * @returns an absolute path to the workspace.
 */
export function workspaceDirFor(session: LiveSession | undefined, fallbackRoot: string): string {
  const cwd = session?.header.cwd
  return typeof cwd === 'string' && cwd.length > 0 ? cwd : fallbackRoot
}

/** Workspaces kept as live stores; beyond this the oldest is dropped. */
const MAX_CACHED_WORKSPACES = 8

/** One store per (workspace, sandbox mode). */
const cache = new Map<string, ProjectStore>()

/**
 * Build (or reuse) the store that treats one workspace as its root.
 *
 * Cached per (directory, sandbox mode): the mode can be switched while the plugin
 * serves a Session, and a store holds the policy it was stamped with, so a second
 * entry costs one listing.
 * @param deps - filesystem, sandbox policy, logger.
 * @param session - the calling Session, for the write policy.
 * @param dir - the workspace directory.
 * @returns a store whose root is `dir` and whose only project is that directory.
 */
export function workspaceStore(
  deps: { fs: FsService; policy: SandboxPolicyService | undefined; log: Logger },
  session: LiveSession | undefined,
  dir: string,
): ProjectStore {
  const write = storyWritePolicy(dir, deps.policy, session)
  const key = `${dir}\u0000${write?.mode ?? ''}`
  let store = cache.get(key)
  if (store === undefined) {
    store = new ProjectStore(deps.fs, dir, deps.log, write)
    cache.set(key, store)
    if (cache.size > MAX_CACHED_WORKSPACES) {
      const oldest = cache.keys().next().value
      if (oldest !== undefined) cache.delete(oldest)
    }
  }
  return store
}
