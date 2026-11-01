/**
 * The story a Session is working in, and moving the Session into it.
 *
 * A story lives at `<story root>/<book>/`, and the story root is the *immutable*
 * `header.cwd` of the Session (`root.ts` reads it on purpose). The **effective**
 * working directory is a different thing: the model's own `read`/`write`/`pwsh`
 * tools resolve relative paths against it, and it starts out as the workspace.
 *
 * So the panel's selection is turned into a working directory: opening a story
 * commits the Session into that story directory, and because
 * `workingDirectory.set` writes a durable `working-directory/change`, the choice
 * survives the next turn, a reload and a resume.
 *
 * @module notebook/story/focus
 */
import type { AgentsService, Logger, WorkingDirectoryService } from '../dsh.js'

/** Everything focusing needs from the host. */
export interface FocusDeps {
  /**
   * Both services are resolved **per call**, not captured at activation: this
   * plugin does not `inject` them, so a profile that registers the session
   * machinery after the panel would otherwise lose the feature silently.
   */
  agents: () => AgentsService | undefined
  workingDirectory: () => WorkingDirectoryService | undefined
  log: Logger
}

/**
 * Move one Session into one story.
 *
 * @param sessionId - the Session whose working directory should move; `undefined`
 *   moves nothing.
 * @param book - absolute story directory.
 * @returns whether the Session now works in that directory.
 */
export type Focus = (sessionId: string | undefined, book: string) => Promise<boolean>

/**
 * Build the focus function over the host's services.
 *
 * The move itself is best-effort — a panel that opened a story must not fail
 * because this profile has no working-directory service, because the Session is
 * gone, or because the directory was removed between the read and the write.
 * Every failure is reported in the log and answered with `false`.
 *
 * @param deps - the agent registry, working-directory service and logger.
 * @returns a function that moves one Session into one story.
 */
export function createFocus(deps: FocusDeps): Focus {
  const { agents, workingDirectory, log } = deps
  let warned = false
  return async (sessionId, book) => {
    if (sessionId === undefined) return false
    const service = workingDirectory()
    if (service === undefined) {
      // Once, not per selection: a profile without the service would otherwise log
      // on every story the panel opens.
      if (!warned) {
        warned = true
        log.warn('notebook: no working-directory service in this profile; the Session keeps its own directory')
      }
      return false
    }
    const agent = agents()?.get(sessionId)
    // A scripted caller can name a Session that is not live; there is nothing to
    // move and nothing worth reporting, since the next panel request retries.
    if (agent === undefined) return false
    try {
      await service.set(agent, book)
      log.info(`notebook: Session ${sessionId} works in ${book}`)
      return true
    } catch (error: unknown) {
      log.warn(`notebook: could not move Session ${sessionId} into ${book}`, error)
      return false
    }
  }
}
