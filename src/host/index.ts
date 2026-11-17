/**
 * Host half of the 笔记本 (Notebook) bundle.
 *
 * Activation wires exactly one thing onto one owned effect, so unloading the
 * plugin removes it: the authenticated JSON control plane. The client half is the
 * panel; the files it edits are the workspace's own, and the harness's `read`/
 * `write` tools already reach them.
 *
 * The three services this depends on are declared in `inject`, which is what
 * keeps the plugin inactive — rather than broken — in a profile that has no web
 * carrier.
 */
import { fallbackRootDir } from './story/bootstrap.js'
import type { PluginContext } from './dsh.js'
import { API_PATH, registerApi } from './http/api.js'
import { createRootResolver } from './story/root.js'
import { createFocus } from './story/focus.js'
import { assessWriteAccess, writeAccessGuidance } from './story/sandbox.js'

/**
 * Services that must exist for this plugin to be useful.
 *
 * Nothing else is required, and nothing optional decides whether the panel
 * works: the tree is rooted at the workspace the Session opened, so there is no
 * directory to choose and no config row to write.
 */
export const inject = ['fs', 'webServer', 'connection']

/**
 * Activate the plugin.
 * @param ctx - the owning context; every registration below is an effect of it.
 * @param rawConfig - the Loader row's `config`, which this plugin no longer has.
 *   It is read only to warn about a row still carrying the retired `rootDir`:
 *   silently ignoring it would leave a profile that looks pinned to a directory
 *   the panel is not showing.
 */
export function apply(ctx: PluginContext, rawConfig?: unknown): void {
  const log = ctx.logger
  const policy = ctx.get('sandboxPolicy')
  const configured: Record<string, unknown> = typeof rawConfig === 'object' && rawConfig !== null
    ? rawConfig as Record<string, unknown>
    : {}
  if (configured.rootDir !== undefined) {
    log.warn('notebook: rootDir is no longer a configuration field; the tree follows the workspace. '
      + 'To keep a notebook somewhere else, open that directory as the workspace.')
  }
  for (const field of Object.keys(configured)) {
    if (field !== 'rootDir') log.warn(`notebook: unknown configuration field ${field}; this plugin takes none`)
  }
  const fallbackRoot = fallbackRootDir(policy)
  // The root is resolved per call rather than here: it follows the workspace of
  // the Session making the call, so one plugin instance serves every workspace in
  // the profile instead of pinning one mutable root. See `root.ts` for the rule
  // and the per-root write policy it stamps.
  const roots = createRootResolver({ fs: ctx.fs, fallbackRoot, policy, agents: ctx.get('agents'), log })
  const initialRoot = roots().root
  const access = assessWriteAccess(initialRoot.dir, policy)
  // Puts the Session into the directory the panel shows, so the model's relative
  // paths and the tree agree; see `story/focus.ts`.
  const focus = createFocus({
    agents: () => ctx.get('agents'),
    workingDirectory: () => ctx.get('workingDirectory'),
    log,
  })

  log.info(`notebook: root=${initialRoot.dir} (${initialRoot.source})`)
  if (initialRoot.source === 'fallback') {
    // A session-less activation. The panel and every call resolve their own root
    // from the Session that made the call, so this fallback is what a scripted
    // caller with no Session would see.
    log.info(`notebook: no Session at activation; fallback root is ${initialRoot.dir}`)
  }
  if (policy === undefined) {
    log.info('notebook: no sandbox-policy service in this profile; writes are unconfined')
  } else if (access.writable) {
    // The boundary a write is checked against is the root of that call, not this
    // deployment value: each write stamps `{ mode, workspaceRoot: <that root> }`
    // (see `sandbox.ts`). The mode, though, is the Session's own.
    log.info(`notebook: writes allowed (mode=${String(access.mode)}, boundary=each call's root)`)
  } else {
    // Worth a warning rather than an error: the plugin still mounts and still
    // reads, and the panel shows the same guidance with the exact YAML to paste.
    log.warn(`notebook: deployment is read-only; every write will be refused\n${String(writeAccessGuidance(initialRoot.dir, access))}`)
  }

  ctx.effect(() => {
    // Registration is synchronous; the returned disposer settles asynchronously
    // because the Fetch bridge may be tearing down a live request.
    const disposeApi = registerApi({
      connection: ctx.connection,
      fs: ctx.fs,
      roots,
      log,
      policy,
      focus,
    })
    return () => { void disposeApi() }
  }, 'notebook: api')

  // Surfaced so the page can show the exact mount point it is talking to without
  // hard-coding it a second time.
  log.info(`notebook: api ${API_PATH}`)
}
