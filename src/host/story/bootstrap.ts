/**
 * The directory a session-less caller falls back to.
 *
 * Notes live **in the workspace the operator opened** (see `root.ts`), so this
 * module covers only what is left over: the directory a caller with no Session at
 * all falls back to.
 *
 * The fallback is the deployment's own write boundary — not a `novels/` shelf
 * inside it. The shelf is gone: the panel's tree was already the workspace, and a
 * second root the plugin invented only had to be explained. Nothing is seeded
 * here either; the workspace's `README.md` is written on first open by
 * `op=ensure-readme`, which is the one file the panel adds rather than a scaffold
 * of empty folders.
 */
import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * Where notes live when no Session resolves a root.
 *
 * Used only for a session-less caller: the panel and every tool call carry a
 * Session, and that Session's workspace is the root. Chosen inside the
 * deployment's write boundary so that even this last resort is writable.
 *
 * `workingDirectory.defaultDirectory` is deliberately not consulted. Its own
 * contract calls it the "absolute deployment fallback for Sessions with no
 * recorded original directory", which on a normal install is simply wherever the
 * Harness was launched from.
 * @param policy - the sandbox policy service, when this profile has one.
 * @returns an absolute directory path; it need not exist yet.
 */
export function fallbackRootDir(policy: { workspaceRoot: string } | undefined): string {
  const boundary = policy?.workspaceRoot
  if (boundary !== undefined && boundary.trim().length > 0) return boundary.trim()
  const configured = process.env.DSH_HOME
  const home = configured !== undefined && configured.trim().length > 0
    ? configured.trim()
    : join(homedir(), '.dsh')
  return join(home, 'notebook')
}
