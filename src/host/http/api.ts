/**
 * The JSON control plane.
 *
 * Connection's Fetch registry matches exact pathnames, so this plugin owns one
 * path — `/api/notebook` — and dispatches on an `op` search parameter.
 * Every call therefore inherits Connection's Host/Origin fence and browser
 * authentication for free, and the page never talks to a bespoke unauthenticated
 * surface.
 *
 * The operations are the notebook's own: read the tree, read and write a file,
 * create a file or a folder, point the Session at the workspace, hand the
 * workspace to the OS file manager, and write the one README a fresh workspace
 * gets. Nothing here knows about stories, design bibles or renders — those
 * layers were removed rather than hidden.
 */
import type { ConnectionService, FsService, Logger, SandboxPolicyService } from '../dsh.js'
import { NotebookError, asNotebookError } from '../errors.js'
import { assertPathName, assertRelativePath } from '../story/paths.js'
import { assessWriteAccess, writeAccessGuidance } from '../story/sandbox.js'
import { WORKSPACE_PROJECT, type OpenRoot, type ProjectStore } from '../story/project.js'
import { workspaceDirFor, workspaceStore } from '../story/workspace.js'
import { revealCommand, revealInFileManager } from './reveal.js'
import { workspaceReadme } from '../story/readme.js'
import { STATUS_BY_CODE } from './status.js'
import type { ApiErrorBody } from '../types.js'
import type { RootResolver } from '../story/root.js'
import type { Focus } from '../story/focus.js'

/** The one path this plugin claims on the Connection Fetch registry. */
export const API_PATH = '/api/notebook'

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })
}

function failure(error: unknown): Response {
  const notebookError = asNotebookError(error)
  const body: ApiErrorBody = { code: notebookError.code, message: notebookError.message }
  return json(body, STATUS_BY_CODE[notebookError.code])
}

/**
 * Read one JSON request body.
 *
 * A missing or malformed body is the caller's mistake and is reported as such,
 * rather than surfacing as an opaque crash inside a handler.
 * @param request - the incoming request.
 * @returns the parsed object; an empty body reads as `{}`.
 */
async function readBody(request: Request): Promise<Record<string, unknown>> {
  const text = await request.text()
  if (text.trim().length === 0) return {}
  try {
    const value: unknown = JSON.parse(text)
    return typeof value === 'object' && value !== null ? value as Record<string, unknown> : {}
  } catch {
    throw new NotebookError('bad-request', 'the request body is not JSON')
  }
}

export interface ApiDeps {
  connection: ConnectionService
  /** The filesystem service, shared with the store. */
  fs: FsService
  /** Resolves the store for one request's workspace; see `root.ts`. */
  roots: RootResolver
  log: Logger
  /** The sandbox policy service, when this profile has one; the report is derived per request. */
  policy: SandboxPolicyService | undefined
  /**
   * Moves the calling Session's working directory onto the workspace.
   *
   * `op=focus` is how the panel's selection reaches the model. See
   * `story/focus.ts`.
   */
  focus: Focus
}

/**
 * Register the control-plane route.
 * @param deps - services and state the operations need.
 * @returns the registration disposer.
 */
export function registerApi(deps: ApiDeps): () => Promise<void> {
  const { connection, fs, roots, log, policy, focus } = deps

  const handle = async (request: Request): Promise<Response> => {
    const url = new URL(request.url)
    const op = url.searchParams.get('op') ?? ''
    // One resolution for the whole request, so every branch below — and the
    // failure path that explains a refusal — agrees on which directory is being
    // talked about. The panel sends the Session it belongs to; a scripted caller
    // may send none, and then the activation fallback applies.
    const sessionId = url.searchParams.get('session') ?? undefined
    const { root, session } = roots(sessionId)
    // The panel's directory column is rooted at the workspace itself.
    const workspaceDir = workspaceDirFor(session, root.dir)
    const workspace = workspaceStore({ fs, policy, log }, session, workspaceDir)
    const open = async (name: unknown): Promise<{ store: ProjectStore; project: OpenRoot }> => {
      if (name === WORKSPACE_PROJECT) return { store: workspace, project: await workspace.openRoot() }
      throw new NotebookError('bad-request', 'this plugin serves the workspace itself; project must be ""')
    }
    const access = assessWriteAccess(workspaceDir, policy, session)
    try {
      switch (op) {
        case 'state': {
          return json({
            rootDir: workspaceDir,
            rootSource: root.source,
            sandbox: {
              mode: access.mode ?? null,
              workspaceRoot: access.workspaceRoot ?? null,
              writable: access.writable,
              // Sending the text rather than a reason code keeps the one copy of
              // the remedy on the half that knows the paths. `null` while the
              // arrangement is the ordinary one: the workspace the operator opened.
              guidance: writeAccessGuidance(workspaceDir, access),
            },
          })
        }
        case 'files': {
          const { store, project } = await open(url.searchParams.get('project'))
          return json({ project: project.id, files: await store.listFiles(project) })
        }
        case 'file': {
          const { store, project } = await open(url.searchParams.get('project'))
          return json(await store.readTextFile(project, url.searchParams.get('path') ?? ''))
        }
        case 'save-file': {
          const body = await readBody(request)
          const { store, project } = await open(body.project)
          const path = assertRelativePath(typeof body.path === 'string' ? body.path : '')
          const content = typeof body.content === 'string' ? body.content : ''
          return json(await store.writeTextFile(project, path, content))
        }
        case 'create-dir': {
          const body = await readBody(request)
          const { store, project } = await open(body.project)
          // One segment, not a path: the panel sends the directory it is aimed
          // at separately, so a name carrying separators could only ever mean
          // something other than what it looks like.
          const name = assertPathName(body.name)
          const dir = typeof body.dir === 'string' && body.dir.length > 0 ? assertRelativePath(body.dir) : ''
          const path = dir === '' ? name : `${dir}/${name}`
          return json(await store.createDirectory(project, path), 201)
        }
        case 'create-file': {
          const body = await readBody(request)
          const { store, project } = await open(body.project)
          const title = typeof body.title === 'string' && body.title.trim().length > 0 ? body.title : '未命名'
          // The directory the author is browsing, sent by the panel. Without one,
          // the workspace root is where the tree is.
          const dir = typeof body.dir === 'string' && body.dir.length > 0 ? assertRelativePath(body.dir) : ''
          // The name is kept exactly as typed: no `.md` the author did not ask
          // for, and no second extension when the name has one. The heading is
          // seeded only for prose names — a `.json` is not a document.
          const name = assertPathName(title)
          const extension = /\.[A-Za-z0-9]+$/.exec(name)?.[0].toLowerCase() ?? ''
          const prose = extension === '' || extension === '.md' || extension === '.markdown'
          const stem = extension === '' ? name : name.slice(0, -extension.length)
          const path = await store.newNamedPath(project, dir, name)
          return json(await store.writeTextFile(project, path, prose ? `# ${stem}\n\n` : ''), 201)
        }
        case 'focus': {
          // The page's directory, made to matter to the model: the Session's
          // working directory becomes the workspace the tree shows. No file is
          // touched, so this is not a write op: a read-only deployment still gets
          // it, and the model still reads the right directory.
          const body = await readBody(request)
          const { project } = await open(body.project)
          const focused = await focus(sessionId, project.abs)
          return json({ project: project.id, dir: project.abs, focused })
        }
        case 'reveal': {
          // Show the workspace in the OS file manager. The directory is always the
          // one this request resolved to; no path is ever taken from the client, so
          // the panel cannot be talked into opening somewhere else. `dryRun` is the
          // test hook: it answers what would be launched without launching it.
          const body = await readBody(request)
          if (body.dryRun === true) {
            const launch = revealCommand(process.platform, workspaceDir)
            return json({ dir: workspaceDir, command: launch.command, args: launch.args, opened: false })
          }
          const opened = await revealInFileManager(workspaceDir)
          if (!opened) log.warn(`cannot open a file manager for ${workspaceDir}`)
          return json({ dir: workspaceDir, opened })
        }
        case 'ensure-readme': {
          // The one file the panel adds to a workspace on first open. Never an
          // overwrite: a workspace that already has a README keeps it, and the
          // answer says so.
          const { store, project } = await open(WORKSPACE_PROJECT)
          const present = await store.readTextFile(project, 'README.md')
            .then(() => true, () => false)
          if (present) return json({ path: 'README.md', created: false })
          await store.writeTextFile(project, 'README.md', workspaceReadme())
          return json({ path: 'README.md', created: true }, 201)
        }
        // Not in the write set: a reply touches nothing.
        default:
          return json({ code: 'bad-request', message: `unknown op ${JSON.stringify(op)}` }, 400)
      }
    } catch (error: unknown) {
      return failure(error)
    }
  }

  return connection.fetch.register({
    path: API_PATH,
    methods: ['GET', 'POST'],
    requestBody: 'buffered',
    fetch: handle,
  })
}
