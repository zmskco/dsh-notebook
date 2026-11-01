/**
 * Domain and wire types shared by both halves.
 *
 * The Client half imports these with `import type`, which esbuild erases, so
 * this module carries no runtime edge between the halves.
 */

/** Resolved plugin configuration. */
export interface NotebookConfig {
  /** Directory the panel's tree is rooted at; absolute. */
  rootDir: string
  /**
   * Whether `rootDir` was actually configured.
   *
   * `false` means the value above is only the activation fallback: the root then
   * follows the workspace of the calling Session, so a fresh install reads and
   * writes the directory the operator opened. See `root.ts`.
   */
  rootDirOverride: boolean
}

/** Every failure the HTTP surface returns carries one of these codes. */
export type ApiErrorCode =
  | 'bad-request'
  | 'not-found'
  | 'conflict'
  | 'forbidden'
  | 'internal'

export interface ApiErrorBody {
  code: ApiErrorCode
  message: string
}

/**
 * How the browser should treat one entry it found in the workspace.
 *
 * Directories are listed as entries in their own right — not inferred from the
 * files beneath them — so a directory the author just created still appears
 * before anything is written into it.
 */
export type FileKind = 'text' | 'directory'

/** One file or directory in the workspace. */
export interface ProjectFileEntry {
  /** Project-relative POSIX path; the browser navigates by this. */
  path: string
  /** Basename, for display. */
  name: string
  bytes: number
  kind: FileKind
}

/** A text file opened in the editor. */
export interface FileDocument {
  path: string
  content: string
  chars: number
  bytes: number
}

/**
 * How the root relates to DSH's file sandbox.
 *
 * Reported before anything is written so the page can warn while the user is
 * still reading, rather than letting the first save produce a filesystem error.
 */
export interface SandboxReport {
  /** The sandbox's deployment default mode, or null without the service. */
  mode: 'read-only' | 'workspace-write' | 'danger-full-access' | null
  /** The boundary a panel write is confined to, or null when unknown. */
  workspaceRoot: string | null
  /** Whether a write to `rootDir` is expected to succeed. */
  writable: boolean
  /** The remedy, already spelled out with absolute paths, or null when writable. */
  guidance: string | null
}

/** The `op=state` response: everything the page needs before listing a tree. */
export interface NotebookState {
  /** Absolute directory the tree is rooted at. */
  rootDir: string
  /**
   * Which rule chose `rootDir`.
   *
   * `workspace` — the calling Session's own directory, the normal case.
   * `override` — a `rootDir` pinned in the profile row.
   * `fallback` — neither was available (a session-less caller).
   */
  rootSource: 'override' | 'workspace' | 'fallback'
  sandbox: SandboxReport
}
