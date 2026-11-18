/**
 * Domain and wire types shared by both halves.
 *
 * The Client half imports these with `import type`, which esbuild erases, so
 * this module carries no runtime edge between the halves.
 */

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
 *
 * `binary` is a file that **exists and is shown**, but cannot be opened in the
 * editor: an image, an archive, a compiled binary. Hiding those made the tree
 * disagree with the folder it browses — "my file is not there" when it is — so
 * they are listed and the panel explains on click why they cannot be previewed.
 */
export type FileKind = 'text' | 'binary' | 'directory'

/** One file or directory in the workspace. */
export interface ProjectFileEntry {
  /** Project-relative POSIX path; the browser navigates by this. */
  path: string
  /** Basename, for display. */
  name: string
  bytes: number
  kind: FileKind
}

/**
 * The `op=files` answer.
 *
 * `truncated` says the walk stopped at its entry cap, so the tree is a *part* of
 * the directory rather than all of it. A cap without that flag is silent
 * misinformation — the panel would say a folder is empty when it is only large.
 */
export interface FileListing {
  files: ProjectFileEntry[]
  truncated: boolean
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
  /** Whether a write to the workspace is expected to succeed. */
  writable: boolean
  /** The remedy, already spelled out with absolute paths, or null when writable. */
  guidance: string | null
}

/** The `op=state` response: everything the page needs before listing a tree. */
export interface NotebookState {
  /**
   * Absolute directory the tree is rooted at.
   *
   * It is the calling Session's own workspace — there is no second root and no
   * rule to report, because the panel shows the directory the operator opened.
   */
  rootDir: string
  sandbox: SandboxReport
}
