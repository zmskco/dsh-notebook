/**
 * Name and relative-path validation.
 *
 * Every path that reaches the filesystem is built here first. The defence is
 * two-layered on purpose: this module rejects the shapes that are never
 * legitimate (absolute paths, `..`, backslashes, drive letters), and
 * {@link ProjectStore.resolveInside} then re-checks the canonicalized target
 * against the root through the filesystem provider, so a symlink or a
 * backend-specific alias cannot escape either.
 */
import { NotebookError } from '../errors.js'

/**
 * Characters no mainstream filesystem accepts inside one path segment.
 *
 * The ASCII forms only. Their fullwidth cousins (`：`, `？`, `＊`) are ordinary
 * characters to every filesystem, so a Chinese title is free to use them.
 */
const ILLEGAL_IN_NAME = /[<>:"/\\|?*\u0000-\u001f\u007f]/

/** Windows device names, reserved with or without an extension. */
const RESERVED_NAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i

/**
 * Cap on a name, in bytes rather than characters.
 *
 * The limit that bites first is ext4's 255 bytes per path segment, and one CJK
 * character costs three of them, so a character-count cap would allow a name
 * that cannot be created.
 */
const MAX_NAME_BYTES = 120

/** Windows silently drops a trailing dot or space, so a name ending in one is a lie. */
const TRAILING_DOTS = /[. ]+$/

/**
 * Validate one name used as a path segment — a file or a folder.
 *
 * Unicode is allowed — a note called 第一章 gets a file called 第一章, which is
 * the point. What is *not* allowed is anything the filesystem would refuse,
 * silently rewrite, or resolve somewhere unintended: separators, the
 * Windows-illegal set, control characters, the reserved device names, a trailing
 * dot or space, and `.` / `..`.
 *
 * Normalizing to NFC first matters on macOS, where the filesystem decomposes
 * accented names: without it, the name the user typed and the name read back
 * from disk are different strings, and every containment or equality check
 * between them fails.
 * @param value - the untrusted name.
 * @returns the normalized, filesystem-safe name.
 * @throws {NotebookError} `bad-request` when the name cannot be a path segment.
 */
export function assertPathName(value: unknown): string {
  if (typeof value !== 'string') {
    throw new NotebookError('bad-request', `name must be a string; received ${JSON.stringify(value)}`)
  }
  const name = value.normalize('NFC').trim().replace(TRAILING_DOTS, '')
  if (name.length === 0) {
    throw new NotebookError('bad-request', 'name must contain something other than spaces and dots')
  }
  if (name === '.' || name === '..') {
    throw new NotebookError('bad-request', `name must not be ${JSON.stringify(name)}`)
  }
  if (ILLEGAL_IN_NAME.test(name)) {
    throw new NotebookError('bad-request', `name must not contain < > : " / \\ | ? * or control characters; received ${JSON.stringify(name)}`)
  }
  if (RESERVED_NAME.test(name)) {
    throw new NotebookError('bad-request', `name must not be a reserved device name such as CON or LPT1; received ${JSON.stringify(name)}`)
  }
  if (Buffer.byteLength(name, 'utf8') > MAX_NAME_BYTES) {
    throw new NotebookError('bad-request', `name must be at most ${String(MAX_NAME_BYTES)} bytes; received ${String(Buffer.byteLength(name, 'utf8'))}`)
  }
  return name
}

/**
 * Normalize a project-relative file path.
 *
 * Accepts forward slashes only; backslashes are rejected rather than rewritten
 * so a Windows-style path from a confused caller fails loudly instead of
 * silently addressing a different file.
 * @param value - the untrusted path.
 * @returns the normalized relative path.
 * @throws {NotebookError} `bad-request` when the path is absolute or escapes upward.
 */
export function assertRelativePath(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new NotebookError('bad-request', 'path must be a non-empty string')
  }
  if (value.includes('\\')) {
    throw new NotebookError('bad-request', `path must use forward slashes; received ${JSON.stringify(value)}`)
  }
  if (value.startsWith('/') || /^[A-Za-z]:/.test(value)) {
    throw new NotebookError('bad-request', `path must be relative to the workspace; received ${JSON.stringify(value)}`)
  }
  const segments = value.split('/')
  if (segments.some(segment => segment.length === 0 || segment === '.' || segment === '..')) {
    throw new NotebookError('bad-request', `path must not contain empty, "." or ".." segments; received ${JSON.stringify(value)}`)
  }
  return segments.join('/')
}
