/**
 * Local declarations of the DSH Host surface this plugin consumes.
 *
 * The plugin deliberately declares these instead of importing
 * `@deepseek-ai/dsh-*`: it is authored outside the DSH source checkout, and
 * those packages are internal build artifacts there. Declaring only what is
 * used keeps the bundle dependency-free, so `dsh plugin add` needs no install
 * script and no version matrix.
 *
 * Every signature below was read from the live services in this profile
 * (`cordis_inspect_query` -> host `Service`), not inferred. When DSH changes a
 * signature, this file is the single place to update.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'

/** A resolved filesystem target. `targetKey` is opaque; never parse it. */
export interface FsTarget {
  targetKey: string
  displayPath: string
}

export interface FsDirEntry {
  name: string
  type: 'file' | 'directory' | 'other'
  target: FsTarget
  version?: string
  size?: number
}

export interface FsInfo {
  version: string
  type: 'file' | 'directory' | 'other'
  size?: number
}

export interface FsWriteOutcome {
  operation: 'create' | 'update'
  version: string
  before: string | null
  after: string
}

export interface SandboxExecutionPolicy {
  mode: 'read-only' | 'workspace-write' | 'danger-full-access'
  workspaceRoot: string
  sessionId?: string
}

export interface FsService {
  resolve(path: string, opts?: { cwd?: string; signal?: AbortSignal }): Promise<FsTarget>
  readText(target: FsTarget, signal?: AbortSignal): Promise<string>
  /**
   * Read a whole regular file as raw bytes, capped at `maxBytes`; a file known
   * or discovered to exceed the cap fails with `FS_TOO_LARGE` rather than
   * returning a truncated result.
   */
  readBytes(target: FsTarget, signal: AbortSignal | undefined, maxBytes: number): Promise<Uint8Array>
  /** Read one byte window without buffering the whole file. */
  readByteRange(target: FsTarget, range: { offset: number; length: number }, signal?: AbortSignal): Promise<Uint8Array>
  writeText(
    target: FsTarget,
    content: string,
    expected?: unknown,
    signal?: AbortSignal,
    sandboxPolicy?: SandboxExecutionPolicy,
  ): Promise<FsWriteOutcome>
  listDir(target: FsTarget, signal?: AbortSignal): Promise<FsDirEntry[]>
  stat(target: FsTarget, signal?: AbortSignal): Promise<FsInfo | undefined>
  contains(parent: FsTarget, child: FsTarget): boolean
  processPath(target: FsTarget): string
}

/** The single content block this plugin produces in tool results. */
export interface TextBlock {
  type: 'text'
  text: string
}

export interface ToolRunContext {
  readonly signal: AbortSignal
  readonly arguments: unknown
  readonly name: string
  /**
   * The Agent this call belongs to, when the registry dispatched it for one.
   *
   * Read from the live `tools` contract: `ToolRunContext extends ToolExecution
   * extends ToolExecutionInput`, whose `agent?: Agent` exposes `id: SessionId`.
   * This is how a tool learns *which* workspace its story root is — the id goes
   * to {@link AgentsService.get}, and the session header carries the cwd.
   */
  readonly agent?: { readonly id: string }
}

/** A model-facing tool argument object: unvalidated at the type level by design. */
export type ToolArgs = Record<string, unknown>

export interface ToolDefinition {
  name: string
  description: string
  parameters: Record<string, unknown>
  output: {
    schema: Record<string, unknown>
    render(args: ToolArgs, value: ToolArgs): TextBlock[]
  }
  timeoutMs?: number
  execute(args: ToolArgs, exec: ToolRunContext): Promise<unknown>
}

export interface ToolRegistry {
  register(definition: ToolDefinition): () => void
}

/** A named HTTP route on the browser carrier. */
export interface WebRoute {
  kind: 'exact' | 'prefix'
  path: string
  handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>
}

export interface WebServerService {
  register(route: WebRoute): () => void
}

export type ConnectionFetchMethod = 'GET' | 'HEAD' | 'POST'
export type ConnectionRequestBodyMode = 'buffered' | 'streaming'

export interface ConnectionFetchRoute {
  path: string
  methods: readonly ConnectionFetchMethod[]
  requestBody: ConnectionRequestBodyMode
  fetch: (request: Request) => Promise<Response>
}

export interface ConnectionService {
  readonly fetch: { register(route: ConnectionFetchRoute): () => Promise<void> }
  /** Host/Origin fence plus browser authentication; `undefined` means admitted. */
  requestRejection(request: { headers: Headers | Record<string, string | readonly string[] | undefined> }): 401 | 403 | undefined
  /** Add the process token to an ordinary Web application URL. */
  authenticatedUrl(baseUrl: string): string
}

/** DSH's three file-sandbox modes, weakest first. */
export type SandboxMode = 'read-only' | 'workspace-write' | 'danger-full-access'

/**
 * The parts of `ctx.sandboxPolicy` this plugin reads.
 *
 * Optional service: a minimal profile need not have one, in which case there is
 * no sandbox to reconcile the novel root with. `workspaceRoot` is the boundary
 * that applies to a call carrying **no session** — which is every write this
 * plugin makes while serving the panel — while tool calls are bounded by their
 * own session's cwd instead.
 */
/**
 * What one capability call asks the policy service for.
 *
 * Structurally DSH's own `SandboxPolicyRequest`: the Session travels whole, not
 * as an id, because the service folds the Session's `sandbox/mode` override and
 * its immutable `header.cwd` into the answer.
 */
export interface SandboxPolicyRequest {
  session?: AgentHandle['session']
  /** An approved explicit mode for this one call, which outranks the Session's. */
  mode?: SandboxMode
}

export interface SandboxPolicyService {
  readonly defaultMode: SandboxMode
  readonly workspaceRoot: string
  /**
   * The complete policy for one call: the Session's mode (or the deployment
   * default) and its cwd as the boundary, or the deployment root when there is
   * no Session to ask about.
   */
  resolve(request?: SandboxPolicyRequest): SandboxExecutionPolicy
}

export interface PromptSection {
  name: string
  order: number
  text: string | ((context: { scope?: unknown }) => string)
}

export interface SystemPromptService {
  section(section: PromptSection): () => void
}

/**
 * The parts of `ctx.workingDirectory` this plugin reads.
 *
 * `header.cwd` — the immutable directory a Session was created in — is the
 * workspace, and stays the story root's anchor (`root.ts` uses it on purpose).
 * The *effective* directory is the one the model's own tools resolve against,
 * and the panel moves it into the open story so relative paths land in the book
 * the author is writing: `set` commits a durable `working-directory/change` and
 * queues the same notice the `cd` tool produces.
 */
export interface WorkingDirectoryService {
  readonly defaultDirectory: string
  /** The effective directory without filesystem I/O; `header.cwd` when unset. */
  get(agent: AgentHandle): string
  /** Commit one Session's directory, returning it; rejects when it is not there. */
  set(agent: AgentHandle, path: string, signal?: AbortSignal): Promise<string>
}

export interface Logger {
  info(...args: unknown[]): void
  warn(...args: unknown[]): void
  error(...args: unknown[]): void
}

/**
 * The plugin context.
 *
 * `effect` runs its callback inside the owning fiber and treats the returned
 * function as that registration's cleanup; `get` reads an optional service
 * without making the plugin depend on it.
 */
/**
 * One live Agent, as far as this plugin reads it.
 *
 * `session.header.cwd` is the **immutable** directory the Session was created
 * in, which is the workspace the operator opened — the same value
 * `sandboxPolicy.resolve` turns into a session's write boundary. Read through
 * `agents` rather than through a tool's own execution context so the panel and
 * the model resolve the identical workspace.
 */
export interface AgentHandle {
  readonly id: string
  readonly session: { readonly header: { readonly cwd?: string } }
}

/**
 * The parts of `ctx.agents` this plugin reads.
 *
 * Optional service. `get` answers a live Session; `currentInitiator` answers the
 * Agent driving one process-local asynchronous chain, which is what a tool
 * execution can consult when it was handed no agent of its own.
 */
export interface AgentsService {
  get(id: string): AgentHandle | undefined
  currentInitiator(): AgentHandle | undefined
}

export interface PluginContext {
  readonly fs: FsService
  readonly webServer: WebServerService
  readonly connection: ConnectionService
  readonly logger: Logger
  get(name: 'tools'): ToolRegistry | undefined
  get(name: 'systemPrompt'): SystemPromptService | undefined
  get(name: 'sandboxPolicy'): SandboxPolicyService | undefined
  get(name: 'agents'): AgentsService | undefined
  /**
   * Optional like the rest: a profile with no Session machinery still serves the
   * panel and still writes novels, it just cannot move a Session into its story.
   */
  get(name: 'workingDirectory'): WorkingDirectoryService | undefined
  get(name: string): unknown
  effect(callback: () => (() => void) | void | Promise<() => void | void>, label?: string): () => void
}
