/**
 * The page's HTTP client for the Host control plane.
 *
 * Every call goes to the same exact path the Host claimed on Connection's
 * Fetch registry, so it is subject to the same Host/Origin fence and browser
 * authentication as the rest of the application. Nothing here retries or
 * caches: the Host is the single source of truth and a stale page is worse than
 * a visible failure.
 */
import type { FileDocument, NotebookState, ProjectFileEntry } from '../host/types'

const API = '/api/notebook'

/**
 * The project id that names the workspace itself.
 *
 * The page's tree is rooted at the workspace the operator opened, so every call
 * it makes names that directory directly — the empty string, which no directory
 * name can be.
 */
export const WORKSPACE_PROJECT = ''

/** A failure reported by the Host, carrying its stable code. */
export class ApiError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'ApiError'
    this.code = code
  }
}

/**
 * The sentence to show for one thrown value.
 *
 * Every panel catches the same way, so the decision lives here rather than in
 * each catch block: the Host's own message is already written for the user,
 * while anything else — a TypeError from a broken response, a string thrown by a
 * browser API — is only useful as its own text.
 * @param cause - whatever a `catch` received.
 * @returns the message for the panel's error banner.
 */
export function messageOf(cause: unknown): string {
  return cause instanceof ApiError ? cause.message : String(cause)
}

/**
 * The Session this page's requests belong to.
 *
 * The Host resolves the workspace root from it, so a request that omits it is
 * served from the deployment fallback instead of the directory the operator
 * opened. Bound while the panel renders, so the page's first read already
 * carries it.
 */
let sessionId: string | undefined

/**
 * Bind the Session every subsequent request belongs to.
 * @param id - the live Session, or `undefined` while the shell has none.
 */
export function bindSession(id: string | undefined): void {
  sessionId = id !== undefined && id.length > 0 ? id : undefined
}

/** Add the bound Session, when there is one, to an outgoing URL. */
function withSession(url: URL): URL {
  if (sessionId !== undefined) url.searchParams.set('session', sessionId)
  return url
}

async function call<T>(op: string, params?: Record<string, string>, body?: unknown): Promise<T> {
  const url = withSession(new URL(API, window.location.origin))
  url.searchParams.set('op', op)
  for (const [key, value] of Object.entries(params ?? {})) url.searchParams.set(key, value)

  let response: Response
  try {
    response = await fetch(url, body === undefined ? { method: 'GET' } : {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  } catch (error: unknown) {
    throw new ApiError('network', `无法连接 Host：${error instanceof Error ? error.message : String(error)}`)
  }

  const text = await response.text()
  let payload: unknown
  try {
    payload = text.length === 0 ? undefined : JSON.parse(text)
  } catch {
    throw new ApiError('internal', `Host 返回了非 JSON 响应（HTTP ${String(response.status)}）`)
  }
  if (!response.ok) {
    const failure = payload as { code?: unknown; message?: unknown } | undefined
    throw new ApiError(
      typeof failure?.code === 'string' ? failure.code : 'internal',
      typeof failure?.message === 'string' ? failure.message : `HTTP ${String(response.status)}`,
    )
  }
  return payload as T
}

export const api = {
  state: (): Promise<NotebookState> => call<NotebookState>('state'),
  /**
   * Tell the Host which directory this page is showing.
   *
   * Not a read: the Host moves the Session's working directory onto the
   * workspace, which is what makes the model's own relative paths agree with the
   * tree. Best-effort from the page's side: the panel's own reads never depend on
   * it.
   */
  focus: (project: string): Promise<{ project: string; dir: string; focused: boolean }> =>
    call<{ project: string; dir: string; focused: boolean }>('focus', {}, { project }),
  files: (project: string): Promise<{ project: string; files: ProjectFileEntry[] }> =>
    call<{ project: string; files: ProjectFileEntry[] }>('files', { project }),
  file: (project: string, path: string): Promise<FileDocument> => call<FileDocument>('file', { project, path }),
  saveFile: (project: string, path: string, content: string): Promise<FileDocument> =>
    call<FileDocument>('save-file', {}, { project, path, content }),
  /**
   * Make a file in the tree.
   *
   * The name is kept exactly as typed — no suffix is added — and the Host seeds a
   * heading only for prose names.
   */
  createFile: (project: string, title: string, dir: string): Promise<FileDocument> =>
    call<FileDocument>('create-file', {}, { project, title, dir }),
  /**
   * Make a directory in the tree.
   *
   * One name, one parent: the Host refuses a name that carries separators, so
   * "new folder" cannot turn into "new path".
   */
  createDir: (project: string, dir: string, name: string): Promise<{ path: string }> =>
    call<{ path: string }>('create-dir', {}, { project, dir, name }),
  /**
   * Show the workspace in the operating system's file manager.
   *
   * The Host decides the directory (the workspace it resolved for this Session);
   * nothing here can name a path, which is what keeps a browser from being used to
   * open arbitrary local folders.
   */
  reveal: (): Promise<{ dir: string; opened: boolean }> =>
    call<{ dir: string; opened: boolean }>('reveal', {}, {}),
  /**
   * Ask the Host for the workspace's `README.md`, creating it on first open.
   *
   * Idempotent: the Host answers `created: false` when the workspace already had
   * one, which is what keeps this safe to fire on every mount.
   */
  ensureReadme: (): Promise<{ path: string; created: boolean }> =>
    call<{ path: string; created: boolean }>('ensure-readme', {}, {}),
}
